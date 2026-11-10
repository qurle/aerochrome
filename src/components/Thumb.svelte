<script lang="ts">
  let {
    bitmap,
    selected = false,
    label,
    disabled = false,
    onclick,
  }: { bitmap?: ImageBitmap; selected?: boolean; label: string; disabled?: boolean; onclick?: () => void } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let shown = $state(false);

  $effect(() => {
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    ctx?.drawImage(bitmap, 0, 0);
    requestAnimationFrame(() => (shown = true));
  });
</script>

<button class="thumb" class:selected {disabled} aria-pressed={selected} aria-label={label} title={label} {onclick}>
  {#if bitmap}<canvas bind:this={canvas} class:shown></canvas>{/if}
</button>

<style>
  .thumb {
    position: relative;
    flex: none;
    width: 64px;
    height: 64px;
    padding: 0;
    border: 0;
    background: var(--placeholder);
    overflow: hidden;
    cursor: pointer;
    border-radius: 0;
    /* Same curve both ways: the old selection squares off while the new one
       rounds, a cross-morph. */
    transition: border-radius 0.32s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.12s ease-out;
    -webkit-tap-highlight-color: transparent;
  }
  .thumb:disabled { cursor: default; }
  /* Focusing by Tab scrolls the tile clear of the list's top/bottom fades. */
  .thumb { scroll-margin-block: 34px; }
  /* 50%, not 999px: animating to a huge radius reaches the circle within the
     first few milliseconds and looks like a jump. */
  .selected { border-radius: 50%; }
  /* Immediate feedback on press, before any rendering happens. */
  .thumb:not(:disabled):active { transform: scale(0.92); }
  @media (prefers-reduced-motion: reduce) {
    .thumb, .selected { transition: none; }
  }
  canvas { display: block; width: 100%; height: 100%; opacity: 0; transition: opacity 0.35s ease-out; }
  canvas.shown { opacity: 1; }
</style>
