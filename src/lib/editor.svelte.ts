import sampleUrl from '../assets/sample.webp?url';
import { LUT_SIZE } from './color/lut';
import { LutCache, Priority, type LutData } from './color/luts';
import type { WorkingSpace } from './color/spaces';
import { TWEAK_NEUTRAL, tweakEffect, tweakWeights } from './color/tweak';
import { encodeJpeg } from './export/jpeg';
import { Renderer, type MaskData, type RenderParams } from './gl/renderer';
import { cropRegion } from './image/crop';
import { drawDitheredDraft } from './image/dither';
import { decodeFull, exportBudget, loadImage, type LoadedImage } from './image/load';
import { loadPhoto, savePhoto } from './image/persist';
import { ALL_PRESETS, GROUPS, findPreset, groupOf, type Preset } from './presets';
import { detectScene } from './seg/detect';
import { modelCached } from './seg/model';

export const DEFAULTS = { strength: 1, sharpen: 0, film: 0, tweak: TWEAK_NEUTRAL };
const THUMB_PX = 128;
/** Thumbnails use a coarser LUT: 8× cheaper to bake, invisible at 64 px. */
const THUMB_LUT = 17;
const COPY_MAX = 4096;
const JPEG_QUALITY = 96;
const MASK_FADE_MS = 600;
const ACTION_COOLDOWN_MS = 1500;

/** Presets whose looks treat foliage specially (Custom looks colour by their own rules). */
export const usesFoliage = (id: string) => groupOf(id).id !== 'custom';

class Editor {
  image = $state.raw<LoadedImage | null>(null);
  /** Restored after a reload (see PRESET_KEY). */
  presetId = $state(loadPreset());
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
  /** `quiet`: work has started but the UI shouldn't show it yet (fast copies don't flicker). */
  busy = $state<null | { kind: 'export' | 'encode' | 'copy' | 'copied'; progress?: number; quiet?: boolean }>(null);
  error = $state<string | null>(null);
  thumbs = $state.raw<Record<string, ImageBitmap>>({});
  /**
   * iOS: finished export waiting for a tap on Save. Downloads there land in
   * Files, not Photos; the share sheet ("Save Image") reaches Photos, but needs
   * a fresh tap, and an export takes longer than iOS keeps the first one.
   */
  pending = $state<File | null>(null);
  renderer: Renderer | null = null;

  private luts = new LutCache();

  // --- Detect foliage: a scene mask refines which pixels are plants.
  /** The switch; remembered for the browser session. */
  foliage = $state(loadFlag(FOLIAGE_KEY));
  /** The model still has to be downloaded (shown next to the switch). */
  foliageDownload = $state(true);
  /** Download progress (0..1), detection running, or a failure message. */
  foliageStatus = $state<null | { kind: 'download'; progress: number } | { kind: 'detect' } | { kind: 'error'; message: string }>(null);
  /** Scene mask of the current photo, once detected. */
  mask = $state.raw<MaskData | null>(null);
  /** Masked LUT variants are in use (from the start of the fade-in to the end of the fade-out). */
  maskOn = $state(false);
  /** How much the mask applies, animated for the cross-fade. */
  maskMix = $state(0);
  private maskAnim = 0;

  /** LUT lookups pick the mask variants while the mask is in use, for presets that use foliage. */
  private masked = (id: string) => this.maskOn && usesFoliage(id);
  private lut = {
    peekBase: (id: string, space: WorkingSpace, size = LUT_SIZE) => this.luts.peekBase(id, space, size, this.masked(id)),
    peekSet: (id: string, space: WorkingSpace, size = LUT_SIZE) => this.luts.peekSet(id, space, size, this.masked(id)),
    base: (id: string, space: WorkingSpace, p: Priority, size = LUT_SIZE) => this.luts.base(id, space, p, size, this.masked(id)),
    set: (id: string, space: WorkingSpace, p: Priority, size = LUT_SIZE) => this.luts.set(id, space, p, size, this.masked(id)),
  };
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
    if (original) return { strength: 0, sharpen: 0, film: 0, recipe: p.film, aberration: 0, split: [0, 0], prism: 0, flare: 0, leak: [0, 0, 0], seed: 0, edge: 0, blend: [0, 0, 0, 0], mask: 0 };
    const fx = spatial(p), k = this.strength;
    // Tweak also varies effect strengths, and its value lays out the light spots.
    const e = (ch: number) => k * tweakEffect(t, ch);
    return {
      strength: k, sharpen: this.sharpen, film: this.film, ...fx, seed: 3.17 + t * 7.31, blend: tweakWeights(t), mask: this.maskMix,
      aberration: fx.aberration * e(0), split: [fx.split[0] * e(1), fx.split[1] * e(1)], prism: fx.prism * e(2),
      flare: fx.flare * e(3), leak: [fx.leak[0] * e(4), fx.leak[1], fx.leak[2] * tweakEffect(t, 5)], edge: fx.edge * e(6),
    };
  }

  attach(canvas: HTMLCanvasElement) {
    const init = () => {
      try {
        this.renderer = new Renderer(canvas);
        if (this.image) this.renderer.setSource(this.image.preview);
        this.renderer.setMask(this.mask);
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
    if (id !== this.presetId) this.sampleFresh = false;
    this.presetId = id;
    savePreset(id);
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
    const ready = this.lut.peekSet(id, space);
    if (ready) this.applyLut(ready);
    else {
      const base = this.lut.peekBase(id, space) ?? (await this.lut.base(id, space, Priority.Now));
      if (job !== this.selectJob) return;
      this.applyLut(base);
      const set = await this.lut.set(id, space, Priority.Now);
      if (job !== this.selectJob) return;
      this.applyLut(set);
    }
    const i = ALL_PRESETS.findIndex((p) => p.id === id);
    for (const d of [1, -1]) void this.lut.set(ALL_PRESETS[(i + d + ALL_PRESETS.length) % ALL_PRESETS.length].id, space, Priority.Soon);
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
    const r = this.renderer, img = this.image, presetId = this.presetId;
    if (!r || !img || !this.currentLut) return false;
    const sides = (['prev', 'next'] as const).filter((k) => targets[k]);
    const ids = { prev: this.neighbour(-1), next: this.neighbour(1) };
    const lutOf = async (id: string) => {
      const t = this.tweakFor(id);
      // Soon, not Now: until these land, the carousel shows a dithered draft.
      return t === TWEAK_NEUTRAL
        ? this.lut.peekBase(id, r.space) ?? this.lut.base(id, r.space, Priority.Soon)
        : this.lut.peekSet(id, r.space) ?? this.lut.set(id, r.space, Priority.Soon);
    };
    const luts = await Promise.all(sides.map((k) => lutOf(ids[k])));
    // Bail if the photo or preset changed while waiting, or an export is running.
    // (The current LUT may have been upgraded meanwhile: restore whichever is live.)
    const cur = this.currentLut;
    if (r !== this.renderer || img !== this.image || !cur || presetId !== this.presetId || this.busy || !guard()) return false;
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
   * Draft neighbours for the swipe carousel: rendered with the small (17³)
   * thumbnail LUT and drawn as a low-res dither, synchronously. Sides whose
   * small LUT isn't cached yet are requested (not waited for); `pending`
   * resolves once those are baked, so the caller can try again.
   */
  renderDrafts(targets: { prev?: HTMLCanvasElement; next?: HTMLCanvasElement }) {
    const r = this.renderer, img = this.image, cur = this.currentLut;
    const drawn: { prev?: boolean; next?: boolean } = {};
    const waits: Promise<unknown>[] = [];
    if (!r || !img || !cur || this.busy) return { drawn, pending: null };
    const c = r.canvas as HTMLCanvasElement;
    let touched = false;
    for (const k of ['prev', 'next'] as const) {
      const t = targets[k];
      if (!t) continue;
      const id = this.neighbour(k === 'prev' ? -1 : 1), tw = this.tweakFor(id);
      const lut = tw === TWEAK_NEUTRAL ? this.lut.peekBase(id, r.space, THUMB_LUT) : this.lut.peekSet(id, r.space, THUMB_LUT);
      if (!lut) {
        waits.push(tw === TWEAK_NEUTRAL ? this.lut.base(id, r.space, Priority.Now, THUMB_LUT) : this.lut.set(id, r.space, Priority.Now, THUMB_LUT));
        continue;
      }
      r.setLut(lut);
      r.render(this.paramsFor(id, tw), [img.width, img.height]);
      if (t.width !== c.width || t.height !== c.height) { t.width = c.width; t.height = c.height; }
      drawDitheredDraft(t, c, r.space);
      drawn[k] = true;
      touched = true;
    }
    if (touched) {
      r.setLut(cur);
      r.render(this.params(this.comparing), [img.width, img.height]);
    }
    return { drawn, pending: waits.length ? Promise.all(waits) : null };
  }

  /**
   * Switch preset and render it on the main canvas within this task, if its
   * LUT is already cached (so a swipe can land in a single frame). Falls back
   * to the async path otherwise. Returns whether it rendered synchronously.
   */
  selectNow(id: string) {
    if (id !== this.presetId) this.sampleFresh = false;
    const r = this.renderer, img = this.image;
    const t = this.tweakFor(id);
    const lut = r && (t === TWEAK_NEUTRAL
      ? this.lut.peekBase(id, r.space) ?? this.lut.peekSet(id, r.space)
      : this.lut.peekSet(id, r.space));
    this.presetId = id;
    savePreset(id);
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
    this.switchTo(ALL_PRESETS[(i + by + ALL_PRESETS.length) % ALL_PRESETS.length].id);
  }

  /** Set by the viewer: snapshot the current frame to cross-fade from. */
  beforeSwitch: (() => void) | null = null;

  /** Keyboard switch: cross-fade from the current frame, land synchronously when cached. */
  private switchTo(id: string) {
    if (id === this.presetId) return;
    this.beforeSwitch?.();
    this.selectNow(id);
    this.announce();
  }

  /** Jump to the same position in the previous/next group. */
  stepGroup(by: number) {
    const gi = GROUPS.indexOf(groupOf(this.presetId));
    const pi = GROUPS[gi].presets.findIndex((p) => p.id === this.presetId);
    const g = GROUPS[(gi + by + GROUPS.length) % GROUPS.length];
    this.switchTo(g.presets[Math.min(pi, g.presets.length - 1)].id);
  }

  /** The bundled sample is showing (until the user opens their own photo). */
  isSample = $state(false);
  /** The sample is still on its first preset (the "Sample" tag shows only then). */
  sampleFresh = $state(true);
  /** The sample is on its way: show its dithered placeholder meanwhile. */
  samplePending = $state(true);
  private userOpened = false;

  /**
   * Show the photo this tab had before a reload, else the bundled sample,
   * unless the user has already opened one.
   */
  async loadSample() {
    if (this.image || this.userOpened) { this.samplePending = false; return; }
    const restored = await loadPhoto();
    if (restored && !this.image && !this.userOpened) {
      await this.open(restored, false, true);
      if (this.image) return;
    }
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

  /** `restored`: the photo comes back from before a reload (already stored). */
  async open(file: File, sample = false, restored = false) {
    if (!sample) { this.userOpened = true; this.samplePending = false; }
    this.error = null;
    this.pending = null;
    try {
      const img = await loadImage(file);
      if (sample && this.userOpened) { img.preview.close(); return; } // user won the race
      this.image?.preview.close();
      this.image = img;
      this.isSample = sample;
      if (!sample && !restored) void savePhoto(file);
      this.renderer?.setSource(img.preview);
      // A new photo needs its own mask: show it by colour rules until detected.
      this.clearMask();
      void this.buildThumbs();
      if (this.foliage) void this.detect();
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
    r.setMask(this.mask, [(img.preview.width - side) / 2 / img.preview.width, (img.preview.height - side) / 2 / img.preview.height,
      (img.preview.width + side) / 2 / img.preview.width, (img.preview.height + side) / 2 / img.preview.height]);
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
      for (const p of ALL_PRESETS) void this.lut.base(p.id, space, Priority.Background);
      for (const p of ALL_PRESETS) void this.lut.set(p.id, space, Priority.Background);
    }
  }

  private thumbSide = 1;

  /** Render one thumbnail with that preset's own Tweak. Returns false if superseded. */
  private async renderThumb(id: string, job: number) {
    const r = this.thumbRenderer;
    if (!r || job !== this.thumbJob) return false;
    const preset = findPreset(id), t = this.tweakFor(id);
    const lut = t === TWEAK_NEUTRAL
      ? await this.lut.base(id, r.space, Priority.Soon, THUMB_LUT)
      : await this.lut.set(id, r.space, Priority.Soon, THUMB_LUT);
    if (job !== this.thumbJob) return false;
    r.setLut(lut);
    const fx = spatial(preset);
    const e = (ch: number) => tweakEffect(t, ch);
    r.render({
      strength: 1, sharpen: 0, film: 0, ...fx, seed: 3.17 + t * 7.31, blend: tweakWeights(t), mask: this.maskOn ? 1 : 0,
      aberration: fx.aberration * e(0), split: [fx.split[0] * e(1), fx.split[1] * e(1)], prism: fx.prism * e(2),
      flare: fx.flare * e(3), leak: [fx.leak[0] * e(4), fx.leak[1], fx.leak[2] * e(5)], edge: fx.edge * e(6),
    }, [this.thumbSide, this.thumbSide]);
    const bmp = await createImageBitmap(r.canvas as HTMLCanvasElement);
    this.thumbs[id]?.close();
    this.thumbs = { ...this.thumbs, [id]: bmp };
    return true;
  }

  /** Detect foliage switch. */
  setFoliage(on: boolean) {
    if (on === this.foliage) return;
    this.foliage = on;
    saveFlag(FOLIAGE_KEY, on);
    if (on) void this.detect();
    else { this.foliageStatus = null; this.fadeMask(0); }
  }

  /** Whether the model is already on this device (no download note needed). */
  async checkModel() {
    this.foliageDownload = !(await modelCached());
  }

  /** Segment the current photo (downloading the model first if needed), then fade the mask in. */
  private async detect() {
    const img = this.image;
    if (!img) return;
    if (this.mask) { void this.showMask(); return; }
    this.foliageStatus = this.foliageDownload ? { kind: 'download', progress: 0 } : { kind: 'detect' };
    try {
      const mask = await detectScene(img.preview, (f) => {
        if (this.foliage && img === this.image) this.foliageStatus = f < 1 ? { kind: 'download', progress: f } : { kind: 'detect' };
      });
      this.foliageDownload = false;
      if (img !== this.image) return; // another photo arrived: it runs its own detection
      this.foliageStatus = null;
      this.mask = mask;
      this.renderer?.setMask(mask);
      if (this.foliage) void this.showMask();
    } catch (e) {
      if (img !== this.image) return;
      this.foliageStatus = { kind: 'error', message: (e as Error).message };
    }
  }

  /** Switch to the masked LUT variants (identical at mix 0), then cross-fade the mask in. */
  private async showMask() {
    const r = this.renderer, id = this.presetId;
    if (!r || !this.mask || this.maskOn) { this.fadeMask(1); return; }
    this.maskOn = true;
    // Wait for what the current view needs, so nothing flickers while switching.
    if (this.masked(id)) {
      const lut = this.tweak === TWEAK_NEUTRAL ? await this.lut.base(id, r.space, Priority.Now) : await this.lut.set(id, r.space, Priority.Now);
      if (!this.maskOn || id !== this.presetId || r !== this.renderer) return;
      this.applyLut(lut);
    }
    this.fadeMask(1);
    void this.loadLut();
    void this.buildThumbs();
  }

  private clearMask() {
    cancelAnimationFrame(this.maskAnim);
    this.mask = null;
    this.maskMix = 0;
    this.renderer?.setMask(null);
    if (this.maskOn) { this.maskOn = false; void this.loadLut(); }
    if (this.foliageStatus?.kind !== 'download') this.foliageStatus = null;
  }

  /** Animate the mask's strength; at 0 the plain LUTs come back. */
  private fadeMask(to: 0 | 1) {
    cancelAnimationFrame(this.maskAnim);
    const from = this.maskMix, start = performance.now();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / MASK_FADE_MS);
      this.maskMix = from + (to - from) * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
      if (t < 1) { this.maskAnim = requestAnimationFrame(step); return; }
      if (to === 0 && this.maskOn) {
        this.maskOn = false;
        void this.loadLut();
        void this.buildThumbs();
      }
    };
    this.maskAnim = requestAnimationFrame(step);
  }

  /** Full pipeline at (up to) `maxSide`, returns RGBA pixels in the working space. */
  private async renderPixels(maxSide = Infinity) {
    const img = this.image!;
    const r = this.renderer!;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height), Math.sqrt(exportBudget() / (img.width * img.height)));
    const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
    // Export with the full Tweak set (or base at 50), even if it's still baking.
    r.setLut(this.tweak === TWEAK_NEUTRAL
      ? await this.lut.base(this.presetId, r.space, Priority.Now)
      : await this.lut.set(this.presetId, r.space, Priority.Now));
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

  /** Copy and export ignore repeats within this window (double clicks, held keys). */
  private lastRun = { copy: 0, export: 0 };
  private canRun(kind: 'copy' | 'export') {
    if (!this.image || !this.renderer || this.busy) return false;
    const now = performance.now();
    if (now - this.lastRun[kind] < ACTION_COOLDOWN_MS) return false;
    this.lastRun[kind] = now;
    return true;
  }

  /** Render, encode and download a full-size JPEG. Returns whether it started. */
  exportJpeg(): boolean {
    if (!this.canRun('export')) return false;
    void this.runExport();
    return true;
  }

  private async runExport() {
    if (!this.renderer) return;
    this.error = null;
    this.busy = { kind: 'export', progress: 0 };
    try {
      const { pixels, width, height, scaled } = await this.renderPixels();
      this.busy = { kind: 'encode' };
      const blob = await encodeJpeg({ pixels, width, height, quality: JPEG_QUALITY, p3: this.renderer.space === 'display-p3' });
      const file = new File([blob], this.fileName(), { type: 'image/jpeg' });
      if (scaled) this.error = `Exported at ${width}×${height}: the original is too large for this device's memory.`;
      if (isIOS() && navigator.canShare?.({ files: [file] })) this.pending = file;
      else download(file);
    } catch (e) {
      this.error = `Export failed: ${(e as Error).message}`;
    } finally {
      this.busy = null;
    }
  }

  /** iOS: open the share sheet for the finished export (call from a tap). */
  async savePending() {
    const file = this.pending;
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
      this.pending = null;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { download(file); this.pending = null; }
    }
  }

  /** Copies a PNG capped at 4096 px. Must be called straight from a click. Returns whether it started. */
  copy(): boolean {
    if (!this.canRun('copy')) return false;
    this.error = null;
    this.busy = { kind: 'copy', progress: 0, quiet: true };
    // Only show progress (and disable buttons) if the copy takes a while.
    const reveal = setTimeout(() => { if (this.busy?.kind === 'copy') this.busy = { ...this.busy, quiet: false }; }, 500);
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
      .then(() => { clearTimeout(reveal); this.busy = { kind: 'copied' }; setTimeout(() => (this.busy = null), 1200); })
      .catch(async (e) => {
        // The clipboard can refuse before the render is done: until it is, the
        // renderer holds export tiles, so the view must not redraw yet.
        await png.catch(() => {});
        clearTimeout(reveal);
        this.busy = null;
        this.error = `Copy failed: ${(e as Error).message}`;
      });
    return true;
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
const FOLIAGE_KEY = 'aerochrome:foliage';
const PRESET_KEY = 'aerochrome:preset';

function loadPreset() {
  try {
    const id = sessionStorage.getItem(PRESET_KEY);
    if (id && ALL_PRESETS.some((p) => p.id === id)) return id;
  } catch { /* storage unavailable */ }
  return ALL_PRESETS[0].id;
}

function savePreset(id: string) {
  try { sessionStorage.setItem(PRESET_KEY, id); } catch { /* storage unavailable */ }
}

function loadFlag(key: string) {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

function saveFlag(key: string, on: boolean) {
  try { sessionStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable: keep in memory only */ }
}

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

/** iPhone and iPad (iPadOS reports itself as a Mac, but with touch). */
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
