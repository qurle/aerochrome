import sampleUrl from '../assets/sample.webp?url';
import { LutCache, Priority, type LutData } from './color/luts';
import { TWEAK_NEUTRAL, tweakEffect, tweakWeights } from './color/tweak';
import { encodeJpeg } from './export/jpeg';
import { Renderer, type RenderParams } from './gl/renderer';
import { cropRegion } from './image/crop';
import { decodeFull, exportBudget, loadImage, type LoadedImage } from './image/load';
import { ALL_PRESETS, GROUPS, findPreset, groupOf, type Preset } from './presets';

export const DEFAULTS = { strength: 1, sharpen: 0, film: 0, tweak: TWEAK_NEUTRAL };
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
  /** Fullscreen zoomable viewer. */
  fullscreen = $state(false);
  /** Variation dial for the current preset, 0–100; 50 = as designed. */
  tweak = $state(DEFAULTS.tweak);
  /** Tweak values the user set per preset; kept for the browser session. */
  private tweaks: Record<string, number> = loadTweaks();
  /** LUT currently shown: base, or base + Tweak variants (shared with fullscreen). */
  currentLut = $state.raw<LutData | null>(null);
  busy = $state<null | { kind: 'export' | 'encode' | 'copy' | 'copied'; progress?: number }>(null);
  error = $state<string | null>(null);
  thumbs = $state.raw<Record<string, ImageBitmap>>({});
  /** Mobile: finished export waiting for a tap on Save (share sheet needs a fresh gesture). */
  pending = $state<File | null>(null);
  renderer: Renderer | null = null;

  private luts = new LutCache();
  private selectJob = 0;
  private thumbRenderer: Renderer | null = null;
  private thumbJob = 0;

  get preset() { return findPreset(this.presetId); }

  params(original = false): RenderParams {
    return this.paramsFor(this.presetId, this.tweak, original);
  }

  /** Render parameters for any preset at a given Tweak (current sliders otherwise). */
  paramsFor(id: string, t: number, original = false): RenderParams {
    const p = findPreset(id);
    if (original) return { strength: 0, sharpen: 0, film: 0, recipe: p.film, aberration: 0, split: [0, 0], prism: 0, flare: 0, leak: [0, 0, 0], seed: 0, edge: 0, blend: [0, 0, 0, 0] };
    const fx = spatial(p), k = this.strength;
    // Tweak also varies effect strengths, and its value lays out the light spots.
    const e = (ch: number) => k * tweakEffect(t, ch);
    return {
      strength: k, sharpen: this.sharpen, film: this.film, ...fx, seed: 3.17 + t * 7.31, blend: tweakWeights(t),
      aberration: fx.aberration * e(0), split: [fx.split[0] * e(1), fx.split[1] * e(1)], prism: fx.prism * e(2),
      flare: fx.flare * e(3), leak: [fx.leak[0] * e(4), fx.leak[1], fx.leak[2] * tweakEffect(t, 5)], edge: fx.edge * e(6),
    };
  }

  attach(canvas: HTMLCanvasElement) {
    const init = () => {
      try {
        this.renderer = new Renderer(canvas);
        if (this.image) this.renderer.setSource(this.image.preview);
        void this.select(this.presetId);
      } catch (e) {
        this.error = (e as Error).message;
      }
    };
    // Mobile browsers may drop the GPU context (memory pressure, tab switch).
    // Ask for it back and rebuild everything when it returns.
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.renderer = null; });
    canvas.addEventListener('webglcontextrestored', () => { init(); this.lutVersion++; });
    init();
  }

  /** Open fullscreen; adds a history entry so Back (or the Android back gesture) closes it. */
  openFullscreen() {
    if (!this.image || this.fullscreen) return;
    this.fullscreen = true;
    history.pushState({ aerochromeFullscreen: true }, '');
  }

  /** Set while fullscreen plays its closing animation (the viewer then calls finishCloseFullscreen). */
  fsClosing = $state(false);
  /** Fullscreen background opacity (0..1) and its transition, so the main photo can fade opposite to it. */
  fsBg = $state(0);
  fsFade = $state('none');
  /** A user gesture is resizing the layout: skip WebGL renders until it settles. */
  gesturing = $state(false);

  /** Ask fullscreen to close; it animates out first. */
  closeFullscreen() {
    if (this.fullscreen) this.fsClosing = true;
  }

  /** Called by the viewer when its closing animation is done. */
  finishCloseFullscreen() {
    this.fsClosing = false;
    this.fullscreen = false;
    if (history.state?.aerochromeFullscreen) history.back();
  }

  /** Browser Back: the history entry is already gone, just animate out. */
  onPopState() {
    if (this.fullscreen) this.fsClosing = true;
  }

  /** Version counter so the viewer re-renders once a LUT lands. */
  lutVersion = $state(0);

  /** Saved Tweak for a preset (50 if never changed this session). */
  tweakFor(id: string) {
    return this.tweaks[id] ?? TWEAK_NEUTRAL;
  }

  select(id: string) {
    this.presetId = id;
    this.tweak = this.tweakFor(id);
    return this.loadLut();
  }

  setTweak(t: number) {
    t = Math.max(0, Math.min(100, Math.round(t)));
    if (t === this.tweak) return;
    this.tweak = t;
    const id = this.presetId;
    if (t === TWEAK_NEUTRAL) delete this.tweaks[id];
    else this.tweaks[id] = t;
    saveTweaks(this.tweaks);
    // No LUT work here: the shader blends the preset's pre-baked variants, so
    // only the weights change. If the set isn't ready yet, it's already coming.
    // Re-render this preset's thumbnail once scrubbing settles.
    clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => void this.renderThumb(id, this.thumbJob), 300);
  }
  private thumbTimer = 0;

  private applyLut(lut: LutData) {
    this.renderer?.setLut(lut);
    this.currentLut = lut;
    this.lutVersion++;
  }

  /**
   * Show the selected preset: its Tweak set if ready, else the base look right
   * away while the set (base + variants for Tweak) is baked first in line.
   * Then neighbours' sets are prepared, since swipes and arrows go there next.
   */
  private async loadLut() {
    const r = this.renderer;
    if (!r) return;
    const job = ++this.selectJob;
    const id = this.presetId, space = r.space;
    const ready = this.luts.peekSet(id, space);
    if (ready) this.applyLut(ready);
    else {
      const base = this.luts.peekBase(id, space) ?? (await this.luts.base(id, space, Priority.Now));
      if (job !== this.selectJob) return;
      this.applyLut(base);
      const set = await this.luts.set(id, space, Priority.Now);
      if (job !== this.selectJob) return;
      this.applyLut(set);
    }
    const i = ALL_PRESETS.findIndex((p) => p.id === id);
    for (const d of [1, -1]) void this.luts.set(ALL_PRESETS[(i + d + ALL_PRESETS.length) % ALL_PRESETS.length].id, space, Priority.Soon);
  }

  /** Previous and next presets in display order (what a swipe goes to). */
  neighbour(by: 1 | -1) {
    const i = ALL_PRESETS.findIndex((p) => p.id === this.presetId);
    return ALL_PRESETS[(i + by + ALL_PRESETS.length) % ALL_PRESETS.length].id;
  }

  /**
   * Render neighbouring presets into 2D canvases for the swipe carousel, using
   * the main renderer and canvas, then restore the current view (and copy it
   * into `cur`, so the carousel can rotate buffers when a swipe lands).
   * Everything after the LUT lookups runs in one task, so the main canvas never
   * shows the neighbours. `guard` is checked right before drawing.
   */
  async renderNeighbours(
    targets: { prev?: HTMLCanvasElement; next?: HTMLCanvasElement; cur?: HTMLCanvasElement },
    w: number, h: number, guard: () => boolean = () => true,
  ) {
    const r = this.renderer, img = this.image, cur = this.currentLut, presetId = this.presetId;
    if (!r || !img || !cur) return false;
    const sides = (['prev', 'next'] as const).filter((k) => targets[k]);
    const ids = { prev: this.neighbour(-1), next: this.neighbour(1) };
    const lutOf = async (id: string) => {
      const t = this.tweakFor(id);
      return t === TWEAK_NEUTRAL
        ? this.luts.peekBase(id, r.space) ?? this.luts.base(id, r.space, Priority.Soon)
        : this.luts.peekSet(id, r.space) ?? this.luts.set(id, r.space, Priority.Soon);
    };
    const luts = await Promise.all(sides.map((k) => lutOf(ids[k])));
    // Bail if anything changed while waiting, or a render is mid-flight elsewhere.
    if (r !== this.renderer || img !== this.image || cur !== this.currentLut || presetId !== this.presetId || this.busy || !guard()) return false;
    const c = r.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) return false;
    const copy = (t: HTMLCanvasElement) => {
      if (t.width !== w || t.height !== h) { t.width = w; t.height = h; }
      t.getContext('2d', { colorSpace: r.space })!.drawImage(c, 0, 0);
    };
    sides.forEach((k, i) => {
      const id = ids[k];
      r.setLut(luts[i]);
      r.render(this.paramsFor(id, this.tweakFor(id)), [img.width, img.height]);
      copy(targets[k]!);
    });
    r.setLut(cur);
    r.render(this.params(this.comparing), [img.width, img.height]);
    if (targets.cur) copy(targets.cur);
    return true;
  }

  /**
   * Switch preset and render it on the main canvas within this task, if its
   * LUT is already cached (so a swipe can land in a single frame). Falls back
   * to the async path otherwise. Returns whether it rendered synchronously.
   */
  selectNow(id: string) {
    const r = this.renderer, img = this.image;
    const t = this.tweakFor(id);
    const lut = r && (t === TWEAK_NEUTRAL
      ? this.luts.peekBase(id, r.space) ?? this.luts.peekSet(id, r.space)
      : this.luts.peekSet(id, r.space));
    this.presetId = id;
    this.tweak = t;
    if (!r || !img || !lut) { void this.loadLut(); return false; }
    this.applyLut(lut);
    r.render(this.params(this.comparing), [img.width, img.height]);
    void this.loadLut(); // upgrades to the Tweak set if only the base was cached
    return true;
  }

  /** Name shown briefly over the photo after switching by swipe or keyboard. */
  flash = $state<string | null>(null);
  private flashTimer = 0;

  announce() {
    this.flash = `${groupOf(this.presetId).name} ${this.preset.name}`;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flash = null), 1100);
  }

  /** Step through presets in display order (keyboard arrows, swipes). */
  step(by: number) {
    const i = ALL_PRESETS.findIndex((p) => p.id === this.presetId);
    void this.select(ALL_PRESETS[(i + by + ALL_PRESETS.length) % ALL_PRESETS.length].id);
    this.announce();
  }

  /** Jump to the same position in the previous/next group. */
  stepGroup(by: number) {
    const gi = GROUPS.indexOf(groupOf(this.presetId));
    const pi = GROUPS[gi].presets.findIndex((p) => p.id === this.presetId);
    const g = GROUPS[(gi + by + GROUPS.length) % GROUPS.length];
    void this.select(g.presets[Math.min(pi, g.presets.length - 1)].id);
    this.announce();
  }

  /** The bundled sample is showing (until the user opens their own photo). */
  isSample = $state(false);
  /** The sample is on its way: show its dithered placeholder meanwhile. */
  samplePending = $state(true);
  private userOpened = false;

  /** Show the bundled sample photo, unless the user has already opened one. */
  async loadSample() {
    if (this.image || this.userOpened) { this.samplePending = false; return; }
    try {
      // Hashed asset: cached for good by the browser and the service worker.
      const res = await fetch(sampleUrl);
      if (!res.ok) return;
      const file = new File([await res.blob()], 'sample.webp', { type: 'image/webp' });
      if (this.image || this.userOpened) return;
      await this.open(file, true);
    } catch { /* offline on first visit: fall back to the empty state */ } finally {
      this.samplePending = false;
    }
  }

  async open(file: File, sample = false) {
    if (!sample) { this.userOpened = true; this.samplePending = false; }
    this.error = null;
    this.pending = null;
    try {
      const img = await loadImage(file);
      if (sample && this.userOpened) { img.preview.close(); return; } // user won the race
      this.image?.preview.close();
      this.image = img;
      this.isSample = sample;
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
    this.thumbSide = side;
    // Selected preset first, then the rest.
    const order = [this.presetId, ...ALL_PRESETS.map((p) => p.id).filter((id) => id !== this.presetId)];
    for (const id of order) {
      if (!(await this.renderThumb(id, job))) break;
    }
    crop.close();
    // Prepare every preset in the background: base looks first (instant
    // switching), then Tweak sets (instant scrubbing). Selections jump ahead.
    if (job === this.thumbJob) {
      const space = this.renderer?.space ?? r.space;
      for (const p of ALL_PRESETS) void this.luts.base(p.id, space, Priority.Background);
      for (const p of ALL_PRESETS) void this.luts.set(p.id, space, Priority.Background);
    }
  }

  private thumbSide = 1;

  /** Render one thumbnail with that preset's own Tweak. Returns false if superseded. */
  private async renderThumb(id: string, job: number) {
    const r = this.thumbRenderer;
    if (!r || job !== this.thumbJob) return false;
    const preset = findPreset(id), t = this.tweakFor(id);
    const lut = t === TWEAK_NEUTRAL
      ? await this.luts.base(id, r.space, Priority.Soon, THUMB_LUT)
      : await this.luts.set(id, r.space, Priority.Soon, THUMB_LUT);
    if (job !== this.thumbJob) return false;
    r.setLut(lut);
    const fx = spatial(preset);
    const e = (ch: number) => tweakEffect(t, ch);
    r.render({
      strength: 1, sharpen: 0, film: 0, ...fx, seed: 3.17 + t * 7.31, blend: tweakWeights(t),
      aberration: fx.aberration * e(0), split: [fx.split[0] * e(1), fx.split[1] * e(1)], prism: fx.prism * e(2),
      flare: fx.flare * e(3), leak: [fx.leak[0] * e(4), fx.leak[1], fx.leak[2] * e(5)], edge: fx.edge * e(6),
    }, [this.thumbSide, this.thumbSide]);
    const bmp = await createImageBitmap(r.canvas as HTMLCanvasElement);
    this.thumbs[id]?.close();
    this.thumbs = { ...this.thumbs, [id]: bmp };
    return true;
  }

  /** Full pipeline at (up to) `maxSide`, returns RGBA pixels in the working space. */
  private async renderPixels(maxSide = Infinity) {
    const img = this.image!;
    const r = this.renderer!;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height), Math.sqrt(exportBudget() / (img.width * img.height)));
    const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
    // Export with the full Tweak set (or base at 50), even if it's still baking.
    r.setLut(this.tweak === TWEAK_NEUTRAL
      ? await this.luts.base(this.presetId, r.space, Priority.Now)
      : await this.luts.set(this.presetId, r.space, Priority.Now));
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
    if (!this.image || !this.renderer || this.busy || this.isSample) return;
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
    if (!this.image || !this.renderer || this.busy || this.isSample) return;
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

/** Per-preset shader effects (scaled by Strength in `params`). */
function spatial(p: Preset) {
  return {
    recipe: p.film,
    aberration: p.aberration ?? 0,
    split: p.split ?? [0, 0],
    prism: p.prism ?? 0,
    flare: p.flare ?? 0,
    leak: p.leak ?? [0, 0, 0],
    edge: p.edge ?? 0,
  } satisfies Partial<RenderParams>;
}

const TWEAKS_KEY = 'aerochrome:tweaks';

function loadTweaks(): Record<string, number> {
  try {
    const v = JSON.parse(sessionStorage.getItem(TWEAKS_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveTweaks(t: Record<string, number>) {
  try {
    sessionStorage.setItem(TWEAKS_KEY, JSON.stringify(t));
  } catch { /* storage unavailable (private mode): keep in memory only */ }
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
