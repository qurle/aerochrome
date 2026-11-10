<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { editor } from '../lib/editor.svelte';
  import dither from '../assets/sample-dither.png?inline';

  let { top, bottom, onopen }: { top?: Snippet; bottom?: Snippet; onopen: () => void } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let avail = $state({ w: 0, h: 0 });
  let topH = $state(0);
  let bottomH = $state(0);
  const rowsH = $derived((top ? topH + 16 : 0) + (bottom ? bottomH + 16 : 0));

  const waiting = $derived(!editor.image && editor.samplePending);
  // The placeholder has the sample's 3:4 shape, so nothing moves when it arrives.
  const aspect = $derived(editor.image ? editor.image.width / editor.image.height : waiting ? 3 / 4 : 4 / 3);
  const fit = $derived.by(() => {
    const h = Math.max(120, avail.h - rowsH);
    const w = Math.max(120, Math.min(avail.w, h * aspect));
    return { w: Math.floor(w), h: Math.floor(w / aspect) };
  });

  onMount(() => {
    editor.attach(canvas);
    const ro = new ResizeObserver(() => {
      const r = box.getBoundingClientRect();
      avail = { w: r.width, h: r.height };
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  // --- Swipe carousel. The previous and next presets are pre-rendered into
  // two 2D canvases when idle. While dragging, the current photo follows the
  // finger and the incoming one slides in from its side, growing from 0.8 and
  // fading in. On release it finishes (or springs back) with a smooth ease;
  // the main view switches preset in the same frame the animation lands.
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let prevCanvas: HTMLCanvasElement;
  let nextCanvas: HTMLCanvasElement;
  /** Swipe progress -1..1: negative = towards next (finger moving left). */
  let p = $state(0);
  let start: { x: number; y: number; t: number } | null = null;
  let swiping = false;
  let samples: { t: number; x: number }[] = [];

  // Motion per layer, from progress. Incoming starts 55% of a width out,
  // at 0.8 scale and transparent; the outgoing photo slides fully out.
  // Layering, never a cross-fade: the incoming photo fades in *under* the
  // current one, which stays fully opaque on top until the two no longer
  // overlap, and only then fades out.
  const ease = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const OUT_SCALE = 0.12, IN_FROM = 0.55, IN_SCALE = 0.8;
  // Progress at which the photos stop overlapping: centre distance
  // (IN_FROM + (1 - IN_FROM)·k)·w reaches the sum of their half widths
  // ((1 - OUT_SCALE·k) + (IN_SCALE + (1 - IN_SCALE)·k))·w / 2.
  const SEPARATE = (1 + IN_SCALE - 2 * IN_FROM) / (2 * (1 - IN_FROM) + OUT_SCALE - (1 - IN_SCALE));
  const cur = $derived.by(() => {
    const k = Math.abs(p);
    return { x: p * fit.w, s: 1 - OUT_SCALE * k, o: 1 - ease(SEPARATE, 1, k) };
  });
  const inc = $derived.by(() => {
    const k = Math.abs(p);
    return { x: Math.sign(p) * -1 * (1 - k) * fit.w * IN_FROM, s: IN_SCALE + (1 - IN_SCALE) * k, o: ease(0, 0.55, k) };
  });

  // Neighbour buffers, each at a level: 0 = plain grey, 1 = dithered
  // low-res draft in the preset's colours, 2 = full render. The incoming layer
  // always animates with whatever level it has, so a swipe never waits.
  // `curCopy` holds the current frame, so when a swipe lands the buffers
  // rotate (current → the side we came from) and only the far side restarts.
  type Side = 'prev' | 'next';
  let curCopy: HTMLCanvasElement | null = null;
  let curValid = false;
  let frameEl: HTMLDivElement;
  let lv = $state<Record<Side, number>>({ prev: 0, next: 0 });
  let readyKey = '';
  const el = (k: Side) => (k === 'prev' ? prevCanvas : nextCanvas);
  const clear = (c: HTMLCanvasElement) => c.getContext('2d')?.clearRect(0, 0, c.width, c.height);

  function stateKey() {
    const img = editor.image;
    return img ? [img.name, img.width, editor.presetId, editor.tweakFor(editor.neighbour(-1)), editor.tweakFor(editor.neighbour(1)),
      editor.strength, editor.sharpen, editor.film, editor.tweak, canvas.width, canvas.height].join('|') : '';
  }

  // Safe at any time, even mid-swipe: renders happen within one task and the
  // main canvas is restored before anything is composited.
  let preparing = false;
  async function prepareNeighbours() {
    if (!editor.image) return;
    const key = stateKey();
    if (key !== readyKey) {
      readyKey = key;
      lv = { prev: 0, next: 0 };
      curValid = false;
      clear(prevCanvas); clear(nextCanvas);
    }
    // 1. Drafts, synchronously, from the small LUTs (requested if missing).
    const want = { prev: lv.prev === 0 ? prevCanvas : undefined, next: lv.next === 0 ? nextCanvas : undefined };
    if (want.prev || want.next) {
      const { drawn, pending } = editor.renderDrafts(want);
      if (drawn.prev || drawn.next) lv = { prev: drawn.prev ? 1 : lv.prev, next: drawn.next ? 1 : lv.next };
      pending?.then(() => { if (stateKey() === key) void prepareNeighbours(); });
    }
    // 2. Full renders, when their LUTs are baked (normal queue priority).
    if (preparing || (lv.prev === 2 && lv.next === 2)) return;
    curCopy ??= document.createElement('canvas');
    preparing = true;
    const full = { prev: lv.prev < 2 ? prevCanvas : undefined, next: lv.next < 2 ? nextCanvas : undefined, cur: curCopy };
    const ok = await editor.renderNeighbours(full, canvas.width, canvas.height, () => stateKey() === key);
    preparing = false;
    if (ok && stateKey() === key) { lv = { prev: 2, next: 2 }; curValid = true; }
    else idle(120); // try again soon
  }

  // Refresh after settings change (debounced); swipes refresh immediately.
  let idleTimer = 0;
  let urgent = false; // a swipe just landed: fill the far side right away
  const idle = (ms: number) => { clearTimeout(idleTimer); idleTimer = window.setTimeout(() => void prepareNeighbours(), ms); };
  // The delay only exists to skip re-renders while sliders are dragged; a new
  // photo (or a swipe that just landed) gets its neighbours right away.
  let lastImage: unknown = null;
  $effect(() => {
    void [editor.image, editor.lutVersion, editor.strength, editor.sharpen, editor.film, editor.tweak, fit.w, fit.h];
    if (editor.gesturing) return;
    const fresh = editor.image !== lastImage;
    lastImage = editor.image;
    idle(urgent || fresh ? 0 : 260);
    urgent = false;
  });

  const copyInto = (dst: HTMLCanvasElement, src: HTMLCanvasElement) => {
    if (dst.width !== src.width || dst.height !== src.height) { dst.width = src.width; dst.height = src.height; }
    const ctx = dst.getContext('2d', { colorSpace: editor.renderer?.space ?? 'srgb' })!;
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0);
  };

  /**
   * Finish a committed swipe: switch the main view in this same frame and
   * rotate the buffers, so a swipe straight back already has its image.
   */
  function land(dir: number) {
    const towardsNext = dir < 0;
    const id = editor.neighbour(towardsNext ? 1 : -1);
    const synced = editor.selectNow(id);
    const back: Side = towardsNext ? 'prev' : 'next', front: Side = towardsNext ? 'next' : 'prev';
    const next: Record<Side, number> = { prev: 0, next: 0 };
    // back ← old current (full quality), current ← incoming if it was full.
    if (synced && curCopy && curValid) { copyInto(el(back), curCopy); next[back] = 2; } else clear(el(back));
    if (synced && curCopy && lv[front] === 2) { copyInto(curCopy, el(front)); curValid = true; } else curValid = false;
    clear(el(front));
    lv = next;
    readyKey = stateKey();
    p = 0;
    editor.announce();
    urgent = true;
    idle(0);
  }


  // --- Gesture. A touch during an animation takes over instead of waiting:
  // during a spring-back it grabs the photo where it is; during a commit it
  // lands instantly and the new drag starts from there.
  let anim: { token: number; to: number } | null = null;
  let token = 0;
  let p0 = 0;

  function down(e: PointerEvent) {
    if (!editor.image) return;
    if (anim) {
      const to = anim.to;
      anim = null;
      token++;
      if (to !== 0) land(to);
    }
    frameEl.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    p0 = p;
    swiping = p0 !== 0; // grabbed mid-motion: already a swipe
    samples = [{ t: start.t, x: e.clientX }];
    if (lv.prev < 2 || lv.next < 2) void prepareNeighbours();
  }
  function move(e: PointerEvent) {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) swiping = true;
    if (!swiping) return;
    samples.push({ t: performance.now(), x: e.clientX });
    while (samples.length > 2 && samples[samples.length - 1].t - samples[0].t > 100) samples.shift();
    p = Math.max(-1, Math.min(1, p0 + dx / fit.w));
  }
  async function up(e: PointerEvent) {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (!swiping) {
      if (Math.hypot(dx, dy) < 8) editor.openFullscreen();
      return;
    }
    swiping = false;
    const a = samples[0], b = samples[samples.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px per ms
    const dir = Math.abs(v) > 0.45 ? Math.sign(v) : Math.abs(p) > 0.3 ? Math.sign(p) : 0;
    if (!dir || Math.sign(p) !== dir) { await animateTo(0, 0.25); return; }
    if (await animateTo(dir, Math.abs(v) / 2.5)) land(dir);
  }
  function cancel() {
    if (!start) return;
    start = null;
    if (swiping) { swiping = false; void animateTo(0, 0.25); }
  }

  /**
   * Animate progress to `to` frame by frame (ease-out-quint), so the layer
   * mapping holds during the release too. Resolves true when it completes,
   * false if a new touch took over.
   */
  function animateTo(to: number, speed: number) {
    const from = p, dist = Math.abs(to - from);
    const ms = reduced() ? 0 : Math.round(Math.max(200, Math.min(480, (dist * 540) / (1 + speed))));
    const my = ++token;
    if (!ms) { p = to; return Promise.resolve(true); }
    anim = { token: my, to };
    const quint = (t: number) => 1 - Math.pow(1 - t, 5);
    return new Promise<boolean>((done) => {
      const t0 = performance.now();
      const step = (now: number) => {
        if (my !== token) { done(false); return; }
        const t = Math.min(1, (now - t0) / ms);
        p = from + (to - from) * quint(t);
        if (t < 1) requestAnimationFrame(step);
        else { anim = null; done(true); }
      };
      requestAnimationFrame(step);
    });
  }

  // Re-render whenever anything visible changes, at most once per frame.
  let raf = 0;
  $effect(() => {
    const img = editor.image;
    const params = editor.params(editor.comparing);
    void editor.lutVersion;
    const { w, h } = fit;
    // While a gesture resizes the layout, the browser just scales the last frame.
    if (editor.gesturing) return;
    if (!img || !editor.renderer || editor.busy?.kind === 'export' || editor.busy?.kind === 'copy') return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.min(img.preview.width, Math.round(w * dpr));
      const ch = Math.round((cw * h) / w);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      editor.renderer!.render(params, [img.width, img.height]);
    });
  });

</script>

<div class="box" bind:this={box}>
  <div class="frame" style:width="{fit.w}px">
    {#if top}<div class="row" bind:clientHeight={topH}>{@render top()}</div>{/if}
    <!-- Gestures live on this stationary frame, not the moving photo, so a
         new swipe registers even while the photo is mid-animation. -->
    <div
      bind:this={frameEl}
      class="image"
      class:placeholder={!editor.image && !waiting}
      class:interactive={!!editor.image}
      style:width="{fit.w}px"
      style:height="{fit.h}px"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={cancel}
      oncontextmenu={(e) => { if (editor.image) e.preventDefault(); }}
      role="presentation"
    >
      <canvas
        class="neighbour"
        bind:this={prevCanvas}
        aria-hidden="true"
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        style:transform="translateX({inc.x}px) scale({inc.s})"
        class:draft={lv.prev === 1}
        style:opacity={p > 0 ? inc.o : 0}
      ></canvas>
      <canvas
        class="neighbour"
        bind:this={nextCanvas}
        aria-hidden="true"
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        style:transform="translateX({inc.x}px) scale({inc.s})"
        class:draft={lv.next === 1}
        style:opacity={p < 0 ? inc.o : 0}
      ></canvas>
      <canvas
        bind:this={canvas}
        class="main"
        class:hidden={!editor.image}
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        title="Open fullscreen (F) · swipe to change preset"
        style:transform="translateX({cur.x}px) scale({cur.s})"
        style:opacity={editor.fullscreen ? 1 - editor.fsBg : cur.o}
        style:transition={editor.fullscreen ? editor.fsFade : 'none'}
      ></canvas>
      {#if waiting}
        <img class="dither" src={dither} alt="" aria-hidden="true" />
      {:else if !editor.image}
        <button class="empty" onclick={onopen}>
          <span>Drop a photo here</span>
          <span class="muted">or tap Open. It never leaves your device.</span>
        </button>
      {/if}
      {#if editor.comparing}<span class="badge">Original</span>
      {:else if editor.flash}<span class="badge">{editor.flash}</span>
      {:else if waiting || (editor.isSample && editor.sampleFresh && p === 0)}<span class="badge sample">Sample</span>{/if}
    </div>
    {#if bottom}<div class="row" bind:clientHeight={bottomH}>{@render bottom()}</div>{/if}
  </div>
</div>

<style>
  .box {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .frame { display: flex; flex-direction: column; gap: 16px; max-width: 100%; }
  .row { display: flex; gap: 8px; }
  .image { position: relative; max-width: 100%; }
  .placeholder { min-width: min(100%, 280px); }
  canvas { display: block; }
  .interactive {
    cursor: zoom-in;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .hidden { display: none; }
  /* The real photo fades in over where the dithered placeholder was. */
  canvas.main:not(.hidden) { animation: reveal 0.45s ease-out; }
  @keyframes reveal { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { canvas.main:not(.hidden) { animation: none; } }
  .main { position: relative; z-index: 1; will-change: transform, opacity; }
  .neighbour {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    will-change: transform, opacity;
  }
  /* A static grey ground; the dithered draft and then the full render land on it. */
  .neighbour { background: var(--placeholder); }
  .neighbour.draft { image-rendering: pixelated; }
  .dither {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
    animation: breathe 1.6s ease-in-out infinite alternate;
  }
  @keyframes breathe { to { opacity: 0.75; } }
  @media (prefers-reduced-motion: reduce) { .dither { animation: none; } }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    border: 0;
    background: transparent;
    text-align: center;
    cursor: pointer;
  }
  .muted { color: var(--muted); }
  .badge {
    position: absolute;
    z-index: 2;
    top: 12px;
    left: 12px;
    padding: 4px 10px;
    background: var(--bg);
    font-size: 13px;
    pointer-events: none;
  }
</style>
