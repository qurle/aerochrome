import type { WorkingSpace } from '../color/spaces';
import { LUT_SIZE } from '../color/lut';
import type { FilmRecipe } from '../presets';
import { BLUR_FRAG, BRIGHT_FRAG, MAIN_FRAG, VERT } from './shaders';

export interface RenderParams {
  strength: number;
  sharpen: number;
  film: number;
  recipe: FilmRecipe;
  aberration: number;
  /** Linear R/B split as a fraction of the image width/height. */
  split: [number, number];
  /** Rainbow dispersion towards the edges (replaces the R/B split when > 0). */
  prism: number;
  /** Iridescent highlight rings and lens ghosts. */
  flare: number;
  /** Prism light spots: amount, count (≤ 12), size as a fraction of the frame. */
  leak: [number, number, number];
  /** Random layout for the light spots. */
  seed: number;
  /** Rainbow tint on contrast edges (0..1). */
  edge: number;
}

type GL = WebGL2RenderingContext;
type Canvas = HTMLCanvasElement | OffscreenCanvas;

interface Program { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }
interface Target { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }

const HALO_SIZE = 384;

/**
 * Picks Display P3 when the browser can both upload and display it, so wide-gamut
 * photos keep their greens and reds. Falls back to sRGB.
 */
function setupColorSpace(gl: GL): WorkingSpace {
  const g = gl as GL & { drawingBufferColorSpace?: string; unpackColorSpace?: string };
  if ('drawingBufferColorSpace' in g && 'unpackColorSpace' in g) {
    try {
      g.drawingBufferColorSpace = 'display-p3';
      g.unpackColorSpace = 'display-p3';
      if (g.drawingBufferColorSpace === 'display-p3' && g.unpackColorSpace === 'display-p3') return 'display-p3';
    } catch { /* fall through */ }
    g.drawingBufferColorSpace = 'srgb';
    g.unpackColorSpace = 'srgb';
  }
  return 'srgb';
}

export class Renderer {
  readonly gl: GL;
  readonly space: WorkingSpace;
  readonly maxTexture: number;
  private main: Program;
  private bright: Program;
  private blur: Program;
  private vao: WebGLVertexArrayObject;
  /** One immutable 3D texture per LUT size, updated in place (see setLut). */
  private lutTex: WebGLTexture | null = null;
  private lutTextures = new Map<number, WebGLTexture>();
  private lutBytes = new Map<number, Uint8Array>();
  private srcTex: WebGLTexture;
  /** Optional full-resolution crop for the fullscreen viewer. */
  private detailTex: WebGLTexture;
  private detailSize: [number, number] = [1, 1];
  private haloA: Target;
  private haloB: Target;
  private srcSize: [number, number] = [1, 1];
  private preview: TexImageSource & { width: number; height: number } | null = null;

  constructor(readonly canvas: Canvas, opts: { preserve?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserve,
    }) as GL | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.space = setupColorSpace(gl);
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    this.main = this.program(MAIN_FRAG, ['uSrc', 'uLut', 'uHalo', 'uLutSize', 'uOutRect', 'uSrcRect', 'uSrcTexel',
      'uImageSize', 'uOutSize', 'uFlipY', 'uStrength', 'uSharpen', 'uFilm', 'uFilmMix', 'uFade', 'uAberr', 'uSplit', 'uPrism', 'uFlare', 'uLeak', 'uSeed', 'uEdge']);
    this.bright = this.program(BRIGHT_FRAG, ['uSrc']);
    this.blur = this.program(BLUR_FRAG, ['uSrc', 'uDir']);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.srcTex = this.texture2d();
    this.detailTex = this.texture2d();
    this.haloA = this.target(HALO_SIZE, HALO_SIZE);
    this.haloB = this.target(HALO_SIZE, HALO_SIZE);
  }

  private program(frag: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    const loc: Program['loc'] = {};
    for (const u of uniforms) loc[u] = gl.getUniformLocation(prog, u);
    return { prog, loc };
  }

  private texture2d() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture2d();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  private lutSize = LUT_SIZE;
  private hasLut = false;

  /**
   * Upload a LUT. Each size gets one immutable RGBA8 texture that is only ever
   * updated in place: re-allocating float 3D textures at changing sizes (as
   * Tweak does while scrubbing) made some mobile GPUs sample black. 8-bit
   * entries are plenty, since the output is 8-bit and filtering interpolates.
   */
  setLut(data: Float32Array) {
    const gl = this.gl;
    const n = Math.round(Math.cbrt(data.length / 4));
    if (n < 2 || n * n * n * 4 !== data.length) return; // malformed: keep the current LUT
    let bytes = this.lutBytes.get(n);
    if (!bytes) this.lutBytes.set(n, (bytes = new Uint8Array(data.length)));
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      bytes[i] = v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0; // also maps NaN to 0
    }
    let tex = this.lutTextures.get(n);
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, n, n, n);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      this.lutTextures.set(n, tex);
    }
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, n, n, n, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.lutTex = tex;
    this.lutSize = n;
    this.hasLut = true;
  }

  private upload(src: TexImageSource & { width: number; height: number }) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.srcSize = [src.width, src.height];
  }

  /** Preview source; also rebuilds the halation glow map from it. */
  setSource(src: TexImageSource & { width: number; height: number }) {
    this.preview = src;
    this.upload(src);
    this.buildHalo();
  }

  private pass(p: Program, target: Target | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    return p.loc;
  }

  private buildHalo() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    let loc = this.pass(this.bright, this.haloA, HALO_SIZE, HALO_SIZE);
    gl.uniform1i(loc.uSrc, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Radius ≈ 2.5% of the frame, independent of image size.
    const [w, h] = this.srcSize;
    const step = (HALO_SIZE * 0.025) / 6;
    const sx = (step / HALO_SIZE) * Math.min(1, h / w);
    const sy = (step / HALO_SIZE) * Math.min(1, w / h);
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.haloA.tex);
      loc = this.pass(this.blur, this.haloB, HALO_SIZE, HALO_SIZE);
      gl.uniform1i(loc.uSrc, 0);
      gl.uniform2f(loc.uDir, sx * (i + 1), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, this.haloB.tex);
      loc = this.pass(this.blur, this.haloA, HALO_SIZE, HALO_SIZE);
      gl.uniform1i(loc.uSrc, 0);
      gl.uniform2f(loc.uDir, 0, sy * (i + 1));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  private drawMain(
    target: Target | null, outW: number, outH: number, p: RenderParams,
    imageSize: [number, number], outRect: number[], srcRect: number[], useDetail = false,
  ) {
    const gl = this.gl;
    const size = useDetail ? this.detailSize : this.srcSize;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, useDetail ? this.detailTex : this.srcTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.haloA.tex);
    gl.activeTexture(gl.TEXTURE0);
    const l = this.pass(this.main, target, outW, outH);
    gl.uniform1i(l.uSrc, 0); gl.uniform1i(l.uLut, 1); gl.uniform1i(l.uHalo, 2);
    gl.uniform1f(l.uLutSize, this.lutSize);
    gl.uniform4fv(l.uOutRect, outRect);
    gl.uniform4fv(l.uSrcRect, srcRect);
    gl.uniform2f(l.uSrcTexel, 1 / size[0], 1 / size[1]);
    gl.uniform2f(l.uImageSize, imageSize[0], imageSize[1]);
    gl.uniform2f(l.uOutSize, outW, outH);
    gl.uniform1f(l.uFlipY, target ? 0 : 1);
    // Until the first LUT arrives from the worker, show the original.
    gl.uniform1f(l.uStrength, this.hasLut ? p.strength : 0);
    gl.uniform1f(l.uSharpen, p.sharpen);
    gl.uniform1f(l.uFilm, p.film);
    gl.uniform4f(l.uFilmMix, p.recipe.grain, p.recipe.halation, p.recipe.vignette, p.recipe.soft);
    gl.uniform1f(l.uFade, p.film * p.recipe.fade * 0.06);
    gl.uniform1f(l.uAberr, p.aberration);
    gl.uniform2f(l.uSplit, p.split[0], p.split[1]);
    gl.uniform1f(l.uPrism, p.prism);
    gl.uniform1f(l.uFlare, p.flare);
    gl.uniform3f(l.uLeak, p.leak[0], p.leak[1], p.leak[2]);
    gl.uniform1f(l.uSeed, p.seed);
    gl.uniform1f(l.uEdge, p.edge);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Render the whole preview source to the canvas at its current size. */
  render(p: RenderParams, imageSize: [number, number], crop: number[] = [0, 0, 1, 1]) {
    const c = this.canvas;
    this.drawMain(null, c.width, c.height, p, imageSize, crop, [0, 0, 1, 1]);
  }

  /** Free GPU memory right away instead of waiting for garbage collection. */
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Upload a full-resolution crop covering `rect` (full-image uv) for sharp zoomed views. */
  setDetail(src: TexImageSource & { width: number; height: number }) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.detailTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.detailSize = [src.width, src.height];
  }

  /**
   * Render the region `view` (full-image uv) to the whole canvas. Without
   * `detailRect` it samples the preview (fast, for gestures); with it, the
   * detail texture uploaded by `setDetail` that covers `detailRect`.
   */
  renderView(p: RenderParams, imageSize: [number, number], view: number[], detailRect?: number[]) {
    const c = this.canvas;
    this.drawMain(null, c.width, c.height, p, imageSize, view, detailRect ?? [0, 0, 1, 1], !!detailRect);
  }

  /**
   * Render the full-resolution image tile by tile and return RGBA pixels.
   * `getTile` must return the source region (with margin) for a pixel rect.
   */
  async renderFull(
    p: RenderParams,
    size: [number, number],
    getTile: (x: number, y: number, w: number, h: number) => TexImageSource & { width: number; height: number },
    onProgress?: (f: number) => void,
  ): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const gl = this.gl;
    const [W, H] = size;
    const margin = 4 + Math.ceil((Math.max(p.aberration, p.prism) * 0.25 + (p.edge > 0 ? 0.006 : 0) + Math.max(Math.abs(p.split[0]), Math.abs(p.split[1]))) * Math.max(W, H));
    const tile = Math.max(256, Math.min(2048, this.maxTexture - 2 * margin));
    const out = new Uint8ClampedArray(W * H * 4);
    const target = this.target(tile, tile);
    const row = new Uint8Array(tile * tile * 4);
    const tilesX = Math.ceil(W / tile), tilesY = Math.ceil(H / tile);
    try {
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const x = tx * tile, y = ty * tile;
          const w = Math.min(tile, W - x), h = Math.min(tile, H - y);
          const sx = Math.max(0, x - margin), sy = Math.max(0, y - margin);
          const sw = Math.min(W, x + w + margin) - sx, sh = Math.min(H, y + h + margin) - sy;
          this.upload(getTile(sx, sy, sw, sh));
          this.drawMain(target, w, h, p, [W, H],
            [x / W, y / H, (x + w) / W, (y + h) / H],
            [sx / W, sy / H, (sx + sw) / W, (sy + sh) / H]);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, row);
          for (let r = 0; r < h; r++) {
            out.set(row.subarray(r * w * 4, (r + 1) * w * 4), ((y + r) * W + x) * 4);
          }
          onProgress?.((ty * tilesX + tx + 1) / (tilesX * tilesY));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    } finally {
      gl.deleteFramebuffer(target.fb);
      gl.deleteTexture(target.tex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (this.preview) this.upload(this.preview);
    }
    return out;
  }
}
