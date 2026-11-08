<script lang="ts">
  let {
    bitmap,
    selected = false,
    label,
    disabled = false,
    onclick,
  }: { bitmap?: ImageBitmap; selected?: boolean; label: string; disabled?: boolean; onclick?: () => void } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    ctx?.drawImage(bitmap, 0, 0);
  });
</script>

<button class="thumb" class:selected {disabled} aria-pressed={selected} aria-label={label} title={label} {onclick}>
  {#if bitmap}<canvas bind:this={canvas}></canvas>{/if}
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
    transition: border-radius 0.25s cubic-bezier(0.3, 0.7, 0.2, 1);
  }
  .thumb:disabled { cursor: default; }
  .selected { border-radius: 999px; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
