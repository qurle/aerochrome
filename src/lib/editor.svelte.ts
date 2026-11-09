import { buildLut } from './color/lut';
import { encodeJpeg } from './export/jpeg';
import { Renderer, type RenderParams } from './gl/renderer';
import { cropRegion } from './image/crop';
import { decodeFull, exportBudget, loadImage, type LoadedImage } from './image/load';
import { ALL_PRESETS, findPreset } from './presets';

export const DEFAULTS = { strength: 1, sharpen: 0, film: 0.12 };
const THUMB_PX = 128;
/** Thumbnails use a coarser LUT: 8× cheaper to bake, invisible at 64 px. */
const THUMB_LUT = 17;
const COPY_MAX = 4096;
const JPEG_QUALITY = 96;

class Editor {
  image = $state.raw<LoadedImage | null>(null);
  presetId = $state(ALL_PRESETS[0].id);
  strength = $state(DEFAULTS.strength);
  sharpen = $state(DEFAULTS.sharpen);
  film = $state(DEFAULTS.film);
  comparing = $state(false);
  busy = $state<null | { kind: 'export' | 'encode' | 'copy' | 'copied'; progress?: number }>(null);
  error = $state<string | null>(null);
  thumbs = $state.raw<Record<string, ImageBitmap>>({});
  /** Mobile: finished export waiting for a tap on Save (share sheet needs a fresh gesture). */
  pending = $state<File | null>(null);
  renderer: Renderer | null = null;

  private luts = new Map<string, Float32Array>();
  private thumbRenderer: Renderer | null = null;
  private thumbJob = 0;

  get preset() { return findPreset(this.presetId); }

  params(original = false): RenderParams {
    const p = this.preset;
    if (original) return { strength: 0, sharpen: 0, film: 0, recipe: p.film, aberration: 0, split: [0, 0] };
    return { strength: this.strength, sharpen: this.sharpen, film: this.film, recipe: p.film, aberration: p.aberration ?? 0, split: p.split ?? [0, 0] };
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.renderer = new Renderer(canvas);
      if (this.image) this.renderer.setSource(this.image.preview);
      this.renderer.setLut(this.lut(this.presetId));
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  lut(id: string) {
    let l = this.luts.get(id);
    if (!l) {
      l = buildLut(findPreset(id).look, this.renderer?.space ?? 'srgb');
      this.luts.set(id, l);
    }
    return l;
  }

  select(id: string) {
    this.presetId = id;
    this.renderer?.setLut(this.lut(id));
  }

  async open(file: File) {
    this.error = null;
    this.pending = null;
    try {
      const img = await loadImage(file);
      this.image?.preview.close();
      this.image = img;
      this.renderer?.setSource(img.preview);
      void this.buildThumbs();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private async buildThumbs() {
    const img = this.image;
    if (!img) return;
    const job = ++this.thumbJob;
    if (!this.thumbRenderer) {
      const c = document.createElement('canvas');
      c.width = c.height = THUMB_PX;
      this.thumbRenderer = new Renderer(c, { preserve: true });
    }
    const r = this.thumbRenderer;
    const side = Math.min(img.preview.width, img.preview.height);
    const crop = await createImageBitmap(cropRegion(img.preview,
      (img.preview.width - side) / 2, (img.preview.height - side) / 2, side, side, THUMB_PX * 2, THUMB_PX * 2));
    r.setSource(crop);
    // Selected preset first, then the rest; yield between LUT bakes.
    const order = [this.presetId, ...ALL_PRESETS.map((p) => p.id).filter((id) => id !== this.presetId)];
    for (const id of order) {
      if (job !== this.thumbJob) break;
      const preset = findPreset(id);
      await new Promise((res) => setTimeout(res, 0));
      r.setLut(buildLut(preset.look, r.space, THUMB_LUT));
      r.render({ strength: 1, sharpen: 0, film: 0.1, recipe: preset.film,
        aberration: preset.aberration ?? 0, split: preset.split ?? [0, 0] }, [side, side]);
      const bmp = await createImageBitmap(r.canvas as HTMLCanvasElement);
      this.thumbs[id]?.close();
      this.thumbs = { ...this.thumbs, [id]: bmp };
    }
    crop.close();
  }

  /** Full pipeline at (up to) `maxSide`, returns RGBA pixels in the working space. */
  private async renderPixels(maxSide = Infinity) {
    const img = this.image!;
    const r = this.renderer!;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height), Math.sqrt(exportBudget() / (img.width * img.height)));
    const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
    const full = await decodeFull(img.file);
    try {
      const pixels = await r.renderFull(this.params(), [W, H],
        (x, y, w, h) => cropRegion(full, x / scale, y / scale, w / scale, h / scale, w, h),
        (f) => { if (this.busy) this.busy = { ...this.busy, progress: f }; });
      return { pixels, width: W, height: H, scaled: scale < 1 };
    } finally {
      full.close();
    }
  }

  private fileName() {
    return `${this.image!.name}-${this.presetId}.jpg`;
  }

  async exportJpeg(): Promise<void> {
    if (!this.image || !this.renderer || this.busy) return;
    this.error = null;
    this.busy = { kind: 'export', progress: 0 };
    try {
      const { pixels, width, height, scaled } = await this.renderPixels();
      this.busy = { kind: 'encode' };
      const blob = await encodeJpeg({ pixels, width, height, quality: JPEG_QUALITY, p3: this.renderer.space === 'display-p3' });
      const file = new File([blob], this.fileName(), { type: 'image/jpeg' });
      if (scaled) this.error = `Exported at ${width}×${height}: the original is too large for this device's memory.`;
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
        this.pending = file;
      } else {
        download(file);
      }
    } catch (e) {
      this.error = `Export failed: ${(e as Error).message}`;
    } finally {
      this.busy = null;
    }
  }

  async savePending() {
    const file = this.pending;
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
      this.pending = null;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') download(file);
    }
  }

  /** Copies a PNG capped at 4096 px. Must be called straight from a click. */
  copy() {
    if (!this.image || !this.renderer || this.busy) return;
    this.error = null;
    this.busy = { kind: 'copy', progress: 0 };
    const png = (async () => {
      const { pixels, width, height } = await this.renderPixels(COPY_MAX);
      const space = this.renderer!.space;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { colorSpace: space })!;
      ctx.putImageData(new ImageData(pixels, width, height, { colorSpace: space }), 0, 0);
      return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'));
    })();
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': png })])
      .then(() => { this.busy = { kind: 'copied' }; setTimeout(() => (this.busy = null), 1200); })
      .catch((e) => { this.busy = null; this.error = `Copy failed: ${(e as Error).message}`; });
  }
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const editor = new Editor();
