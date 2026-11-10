// Low-resolution, ordered-dithered draft of a rendered frame: a quick
// placeholder that already shows a preset's colours (same visual language as
// the sample's dithered placeholder) while the full render is on its way.

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DRAFT_WIDTH = 96;
const LEVELS = 6; // per channel

let small: HTMLCanvasElement | null = null;

/** Draw `src` into `dst` as a pixelated, dithered draft. Synchronous. */
export function drawDitheredDraft(dst: HTMLCanvasElement, src: CanvasImageSource & { width: number; height: number }, space: PredefinedColorSpace) {
  const w = DRAFT_WIDTH, h = Math.max(1, Math.round((src.height / src.width) * DRAFT_WIDTH));
  small ??= document.createElement('canvas');
  if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
  const sctx = small.getContext('2d', { colorSpace: space, willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h, { colorSpace: space });
  const d = img.data, step = 255 / (LEVELS - 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5; // -0.5..0.5
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] / step + t;
        d[i + c] = Math.max(0, Math.min(LEVELS - 1, Math.round(v))) * step;
      }
    }
  }
  sctx.putImageData(img, 0, 0);
  const ctx = dst.getContext('2d', { colorSpace: space })!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(small, 0, 0, dst.width, dst.height);
}
