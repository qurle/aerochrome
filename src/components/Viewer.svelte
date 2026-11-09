<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { editor } from '../lib/editor.svelte';

  let { top, bottom, onopen }: { top?: Snippet; bottom?: Snippet; onopen: () => void } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let avail = $state({ w: 0, h: 0 });
  let topH = $state(0);
  let bottomH = $state(0);
  const rowsH = $derived((top ? topH + 16 : 0) + (bottom ? bottomH + 16 : 0));

  const aspect = $derived(editor.image ? editor.image.width / editor.image.height : 4 / 3);
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

  // Tap opens fullscreen; a horizontal swipe steps to the next/previous preset.
  let start: { x: number; y: number; t: number } | null = null;
  function down(e: PointerEvent) {
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
  function up(e: PointerEvent) {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = performance.now() - start.t;
    start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) editor.step(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 8) editor.openFullscreen();
  }

  // Re-render whenever anything visible changes, at most once per frame.
  let raf = 0;
  $effect(() => {
    const img = editor.image;
    const params = editor.params(editor.comparing);
    void editor.lutVersion;
    const { w, h } = fit;
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
    <div class="image" class:placeholder={!editor.image} style:width="{fit.w}px" style:height="{fit.h}px">
      <canvas
        bind:this={canvas}
        class:hidden={!editor.image}
        style:width="{fit.w}px"
        style:height="{fit.h}px"
        title="Open fullscreen (F) · swipe to change preset"
        onpointerdown={down}
        onpointerup={up}
        onpointercancel={() => (start = null)}
        oncontextmenu={(e) => e.preventDefault()}
      ></canvas>
      {#if !editor.image}
        <button class="empty" onclick={onopen}>
          <span>Drop a photo here</span>
          <span class="muted">or tap Open. It never leaves your device.</span>
        </button>
      {/if}
      {#if editor.comparing}<span class="badge">Original</span>
      {:else if editor.flash}<span class="badge">{editor.flash}</span>{/if}
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
