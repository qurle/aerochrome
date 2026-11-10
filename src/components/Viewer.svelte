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

  // Tap opens fullscreen. A horizontal drag slides the photo with the finger;
  // past a threshold (or on a flick) it slides out and the next preset slides in.
  // All CSS transforms on the rendered canvas; one WebGL render per switch.
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(0.2, 0.85, 0.25, 1)';
  let slide = $state({ x: 0, op: 1, tr: 'none' });
  let start: { x: number; y: number; t: number } | null = null;
  let swiping = false;
  let samples: { t: number; x: number }[] = [];

  function down(e: PointerEvent) {
    if (!editor.image) return;
    canvas.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    swiping = false;
    samples = [{ t: start.t, x: e.clientX }];
  }
  function move(e: PointerEvent) {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) swiping = true;
    if (!swiping) return;
    samples.push({ t: performance.now(), x: e.clientX });
    while (samples.length > 2 && samples[samples.length - 1].t - samples[0].t > 100) samples.shift();
    slide = { x: dx, op: 1 - Math.min(0.5, Math.abs(dx) / fit.w), tr: 'none' };
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
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    const dir = Math.abs(v) > 0.5 ? Math.sign(v) : Math.abs(dx) > fit.w * 0.25 ? Math.sign(dx) : 0;
    if (!dir) { await go({ x: 0, op: 1 }, 220); return; }
    await go({ x: dir * fit.w * 0.6, op: 0 }, 140);
    editor.step(dir < 0 ? 1 : -1);
    slide = { x: -dir * fit.w * 0.25, op: 0, tr: 'none' };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await go({ x: 0, op: 1 }, 240);
  }
  function go(to: { x: number; op: number }, ms: number) {
    ms = reduced() ? 0 : ms;
    slide = { ...to, tr: ms ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : 'none' };
    return new Promise((r) => setTimeout(r, ms));
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
        bind:this={canvas}
        class:hidden={!editor.image}
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        title="Open fullscreen (F) · swipe to change preset"
        style:transform="translateX({slide.x}px)"
        style:opacity={editor.fullscreen ? 1 - editor.fsBg : slide.op}
        style:transition={editor.fullscreen ? editor.fsFade : slide.tr}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={() => { start = null; if (swiping) { swiping = false; void go({ x: 0, op: 1 }, 220); } }}
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
  canvas:not(.hidden) { animation: reveal 0.45s ease-out; }
  @keyframes reveal { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { canvas:not(.hidden) { animation: none; } }
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
    top: 12px;
    left: 12px;
    padding: 4px 10px;
    background: var(--bg);
    font-size: 13px;
    pointer-events: none;
  }
</style>
