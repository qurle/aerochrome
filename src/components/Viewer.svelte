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
  let animating = false;
  let samples: { t: number; x: number }[] = [];
  let neighboursKey = '';
  let neighboursReady = $state(false);

  // Motion per layer, from progress. Incoming starts 55% of a width out,
  // at 0.8 scale and transparent; the outgoing photo slides fully out.
  // Fades are sequential, never overlapping, so each layer stays solid:
  // the outgoing photo fades out over the first half of the swipe, the
  // incoming one fades in over the second half.
  const ease = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const cur = $derived({ x: p * fit.w, s: 1 - Math.abs(p) * 0.12, o: 1 - ease(0, 0.5, Math.abs(p)) });
  const inc = $derived.by(() => {
    const k = Math.abs(p);
    return { x: Math.sign(p) * -1 * (1 - k) * fit.w * 0.55, s: 0.8 + 0.2 * k, o: ease(0.5, 1, k) };
  });

  function stateKey() {
    const img = editor.image;
    return img ? [img.name, img.width, editor.presetId, editor.neighbour(-1), editor.neighbour(1),
      editor.tweakFor(editor.neighbour(-1)), editor.tweakFor(editor.neighbour(1)),
      editor.strength, editor.sharpen, editor.film, canvas.width, canvas.height, editor.lutVersion].join('|') : '';
  }

  async function prepareNeighbours() {
    const key = stateKey();
    if (!key || key === neighboursKey || animating || swiping) return;
    neighboursReady = false;
    const ok = await editor.renderNeighbours({ prev: prevCanvas, next: nextCanvas }, canvas.width, canvas.height);
    if (ok && key === stateKey()) { neighboursKey = key; neighboursReady = true; }
  }

  // Refresh the neighbours shortly after things settle.
  let idleTimer = 0;
  $effect(() => {
    void [editor.image, editor.presetId, editor.lutVersion, editor.strength, editor.sharpen, editor.film, editor.tweak, fit.w, fit.h];
    if (editor.gesturing) return;
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => void prepareNeighbours(), 260);
  });

  function down(e: PointerEvent) {
    if (!editor.image || animating) return;
    canvas.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    swiping = false;
    samples = [{ t: start.t, x: e.clientX }];
    if (!neighboursReady) void prepareNeighbours();
  }
  function move(e: PointerEvent) {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) swiping = true;
    if (!swiping) return;
    samples.push({ t: performance.now(), x: e.clientX });
    while (samples.length > 2 && samples[samples.length - 1].t - samples[0].t > 100) samples.shift();
    p = Math.max(-1, Math.min(1, dx / fit.w));
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
    animating = true;
    if (!dir || Math.sign(p) !== dir) {
      await animateTo(0, 0.25);
      animating = false;
      return;
    }
    await animateTo(dir, Math.max(Math.abs(v) / 2.5, 0));
    // Land: switch the main view to the incoming preset, then drop the layers
    // in the same frame its first render shows.
    await editor.select(editor.neighbour(dir < 0 ? 1 : -1));
    editor.announce();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    p = 0;
    neighboursReady = false;
    animating = false;
  }
  /**
   * Animate progress to `to` frame by frame, so the layer mapping (sequential
   * fades, scale, position) holds during the release too; CSS transitions
   * would interpolate each layer's opacity independently and cross-fade.
   * A faster flick shortens the duration.
   */
  function animateTo(to: number, speed: number) {
    const from = p, dist = Math.abs(to - from);
    const ms = reduced() ? 0 : Math.round(Math.max(220, Math.min(520, (dist * 560) / (1 + speed))));
    if (!ms) { p = to; return Promise.resolve(); }
    const quint = (t: number) => 1 - Math.pow(1 - t, 5); // ease-out-quint
    return new Promise<void>((done) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        p = from + (to - from) * quint(t);
        if (t < 1) requestAnimationFrame(step); else done();
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
    <div class="image" class:placeholder={!editor.image && !waiting} style:width="{fit.w}px" style:height="{fit.h}px">
      <canvas
        class="neighbour"
        bind:this={prevCanvas}
        aria-hidden="true"
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        style:transform="translateX({inc.x}px) scale({inc.s})"
        style:opacity={neighboursReady && p > 0 ? inc.o : 0}
      ></canvas>
      <canvas
        class="neighbour"
        bind:this={nextCanvas}
        aria-hidden="true"
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        style:transform="translateX({inc.x}px) scale({inc.s})"
        style:opacity={neighboursReady && p < 0 ? inc.o : 0}
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
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={() => { start = null; if (swiping) { swiping = false; animating = true; void animateTo(0, 0.25).then(() => (animating = false)); } }}
        oncontextmenu={(e) => e.preventDefault()}
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
      {:else if editor.isSample || waiting}<span class="badge sample">Sample</span>{/if}
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
  canvas {
    display: block;
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
