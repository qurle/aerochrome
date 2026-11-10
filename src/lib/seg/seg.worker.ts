/// <reference lib="webworker" />
// Scene segmentation for "Detect foliage": finds vegetation, forested terrain
// and man-made objects so looks can colour foliage that its colour alone
// doesn't give away (hazy, blue-grey distant forest) and leave green objects
// alone.
//
// Model: SegFormer-B2 fine-tuned on ADE20K (NVIDIA), int8-quantised ONNX export
// (Xenova/segformer-b2-finetuned-ade-512-512). LICENCE: NVIDIA's SegFormer
// licence allows non-commercial use only. If this app ever goes commercial,
// swap the model for a permissively licensed one.
import * as ort from 'onnxruntime-web/wasm';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { MODEL_CACHE, MODEL_URL } from './model';
/**
 * Network input: short side 512 px, proportions kept (dimensions in steps of 32),
 * long side capped for panoramas. Squashing to a square, as the model card does,
 * loses much of the vegetation in portrait photos.
 */
const INPUT_SHORT = 512, INPUT_LONG = 704;
/** Long side of the refined mask. */
const MASK_MAX = 768;

// ADE20K class indices.
const VEGETATION = [4, 9, 17, 29, 66, 72]; // tree, grass, plant, field, flower, palm
const TERRAIN = [16, 68]; // mountain, hill: forested from afar
// Things that are never plants: people, vehicles, signs, furniture, fabric…
const OBJECTS = [
  12, 20, 76, 80, 83, 90, 102, 103, 116, 127, // person, car, boat, bus, truck, airplane, van, ship, minibike, bicycle
  43, 100, 123, 149, 86, 106, 114, 136, 87, // signboard, poster, trade name, flag, awning, canopy, tent, traffic light, streetlight
  115, 92, 81, 131, 18, 28, 39, 57, // bag, apparel, towel, blanket, curtain, rug, cushion, pillow
  19, 23, 30, 31, 69, 15, 33, 110, 97, // chair, sofa, armchair, seat, bench, table, desk, stool, ottoman
  98, 108, 119, 126, 130, 89, 143, 141, 22, 147, // bottle, plaything, ball, animal, screen, tv, monitor, crt, painting, glass
];

export type SegRequest = { type: 'run'; id: number; image: ImageBitmap };
export type SegResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'mask'; id: number; data: Uint8Array; width: number; height: number; ms: number }
  | { type: 'error'; id: number; message: string };

const post = (m: SegResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let session: Promise<ort.InferenceSession> | null = null;

/** The model, from Cache Storage or the network (reporting progress), decompressed. */
async function loadModel(): Promise<Uint8Array> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  let res = await cache?.match(MODEL_URL);
  let bytes: Uint8Array;
  if (res) {
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    res = await fetch(MODEL_URL);
    if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const now = performance.now();
      // A server that compresses the transfer reports the smaller size: clamp.
      if (now - last > 100) { post({ type: 'progress', loaded: Math.min(loaded, total), total }); last = now; }
    }
    post({ type: 'progress', loaded, total: total || loaded });
    bytes = new Uint8Array(loaded);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    await cache?.put(MODEL_URL, new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
  }
  // Stored gzipped; a server that adds Content-Encoding has already unpacked it.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

function getSession() {
  session ??= (async () => {
    ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    return ort.InferenceSession.create(await loadModel(), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })().catch((e) => { session = null; throw e; });
  return session;
}

function pixels(image: ImageBitmap, w: number, h: number) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function inputSize(w: number, h: number) {
  const s = Math.min(INPUT_SHORT / Math.min(w, h), INPUT_LONG / Math.max(w, h));
  const r32 = (v: number) => Math.max(32, Math.round((v * s) / 32) * 32);
  return [r32(w), r32(h)];
}

/** ImageNet-normalised, planar RGB. */
function preprocess(image: ImageBitmap) {
  const [w, h] = inputSize(image.width, image.height);
  const d = pixels(image, w, h);
  const n = w * h, out = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) out[c * n + i] = (d[i * 4 + c] / 255 - mean[c]) / std[c];
  return new ort.Tensor('float32', out, [1, 3, h, w]);
}

/** Per-pixel class probabilities summed into vegetation, terrain and object maps. */
function groups(logits: Float32Array, K: number, n: number) {
  const veg = new Float32Array(n), ter = new Float32Array(n), obj = new Float32Array(n);
  const isVeg = new Uint8Array(K), isTer = new Uint8Array(K), isObj = new Uint8Array(K);
  VEGETATION.forEach((k) => (isVeg[k] = 1));
  TERRAIN.forEach((k) => (isTer[k] = 1));
  OBJECTS.forEach((k) => (isObj[k] = 1));
  for (let p = 0; p < n; p++) {
    let m = -Infinity;
    for (let k = 0; k < K; k++) m = Math.max(m, logits[k * n + p]);
    let s = 0, v = 0, t = 0, o = 0;
    for (let k = 0; k < K; k++) {
      const e = Math.exp(logits[k * n + p] - m);
      s += e;
      if (isVeg[k]) v += e; else if (isTer[k]) t += e; else if (isObj[k]) o += e;
    }
    veg[p] = v / s; ter[p] = t / s; obj[p] = o / s;
  }
  return [veg, ter, obj];
}

/** Bilinear resize of a single-channel map (texel centres aligned). */
function resize(src: Float32Array, sw: number, sh: number, w: number, h: number) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / w - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const b = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * w + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Mean over a (2r+1)² window, clamped at the borders. O(1) per pixel. */
function box(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  const k = 1 / ((2 * r + 1) * (2 * r + 1));
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s * k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/**
 * Colour guided filter (He et al.): snaps the coarse 128² class maps to the
 * photo's own edges, so branches against the sky don't get halos. The colour
 * guide matters: leaves and sky often have the same brightness.
 */
function guidedFilter(guide: Uint8ClampedArray, w: number, h: number, maps: Float32Array[], r: number, eps: number) {
  const n = w * h;
  const I = [0, 1, 2].map((c) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = guide[i * 4 + c] / 255; return a; });
  const mul = (a: Float32Array, b: Float32Array) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[i] * b[i]; return o; };
  const mI = I.map((c) => box(c, w, h, r));
  const pairs = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  const cov = pairs.map(([a, b]) => { const m = box(mul(I[a], I[b]), w, h, r); for (let i = 0; i < n; i++) m[i] -= mI[a][i] * mI[b][i]; return m; });
  return maps.map((p) => {
    const mp = box(p, w, h, r);
    const cIp = I.map((c, k) => { const m = box(mul(c, p), w, h, r); for (let i = 0; i < n; i++) m[i] -= mI[k][i] * mp[i]; return m; });
    const A = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], B = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // Solve (Σ + εI)·a = cov(I, p) with the 3×3 symmetric inverse.
      const rr = cov[0][i] + eps, rg = cov[1][i], rb = cov[2][i], gg = cov[3][i] + eps, gb = cov[4][i], bb = cov[5][i] + eps;
      const i00 = gg * bb - gb * gb, i01 = rb * gb - rg * bb, i02 = rg * gb - rb * gg;
      const i11 = rr * bb - rb * rb, i12 = rb * rg - rr * gb, i22 = rr * gg - rg * rg;
      const det = rr * i00 + rg * i01 + rb * i02;
      const x = cIp[0][i], y = cIp[1][i], z = cIp[2][i];
      const a0 = (i00 * x + i01 * y + i02 * z) / det, a1 = (i01 * x + i11 * y + i12 * z) / det, a2 = (i02 * x + i12 * y + i22 * z) / det;
      A[0][i] = a0; A[1][i] = a1; A[2][i] = a2;
      B[i] = mp[i] - a0 * mI[0][i] - a1 * mI[1][i] - a2 * mI[2][i];
    }
    const mA = A.map((a) => box(a, w, h, r)), mB = box(B, w, h, r);
    const q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = mA[0][i] * I[0][i] + mA[1][i] * I[1][i] + mA[2][i] * I[2][i] + mB[i];
    return q;
  });
}

async function run(req: SegRequest) {
  const t0 = performance.now();
  const s = await getSession();
  const input = preprocess(req.image);
  const out = await s.run({ [s.inputNames[0]]: input });
  const logits = out[s.outputNames[0]];
  const [, K, lh, lw] = logits.dims;
  const coarse = groups(logits.data as Float32Array, K, lh * lw);
  input.dispose(); logits.dispose();

  const { width: iw, height: ih } = req.image;
  const scale = Math.min(1, MASK_MAX / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
  const guide = pixels(req.image, w, h);
  req.image.close();
  const fine = guidedFilter(guide, w, h, coarse.map((m) => resize(m, lw, lh, w, h)), Math.max(2, Math.round(Math.max(w, h) / 96)), 2e-3);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) { const v = fine[c][i]; data[i * 4 + c] = v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0; }
    data[i * 4 + 3] = 255;
  }
  post({ type: 'mask', id: req.id, data, width: w, height: h, ms: Math.round(performance.now() - t0) }, [data.buffer]);
}

self.onmessage = (e: MessageEvent<SegRequest>) => {
  run(e.data).catch((err) => post({ type: 'error', id: e.data.id, message: (err as Error).message }));
};
