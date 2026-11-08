type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let ctx: Ctx | null = null;

/**
 * Crop (and optionally scale) a region of a bitmap through a small 2D canvas.
 * Used instead of createImageBitmap(bitmap, sx, sy, …), which handles EXIF-rotated
 * sources inconsistently across browsers. The canvas is wide-gamut when possible.
 */
export function cropRegion(
  src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dw = sw, dh = sh,
): HTMLCanvasElement | OffscreenCanvas {
  if (!canvas) {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(dw, dh) : document.createElement('canvas');
    ctx = canvas.getContext('2d', { colorSpace: 'display-p3', willReadFrequently: false }) as Ctx | null;
    if (!ctx) throw new Error('2D canvas unavailable');
  }
  if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
  ctx!.imageSmoothingQuality = 'high';
  ctx!.clearRect(0, 0, dw, dh);
  ctx!.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}
