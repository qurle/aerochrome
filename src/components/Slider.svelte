<script lang="ts">
  let {
    label,
    value = $bindable(),
    color,
    defaultValue = 0,
    disabled = false,
  }: { label: string; value: number; color: string; defaultValue?: number; disabled?: boolean } = $props();

  let track: HTMLDivElement;
  let dragging = false;

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  function setFrom(e: PointerEvent) {
    const r = track.getBoundingClientRect();
    value = clamp((e.clientX - r.left) / r.width);
  }
  function down(e: PointerEvent) {
    if (disabled) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    setFrom(e);
  }
  function move(e: PointerEvent) { if (dragging) setFrom(e); }
  function up() { dragging = false; }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') value = clamp(value + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') value = clamp(value - step);
    else if (e.key === 'Home') value = 0;
    else if (e.key === 'End') value = 1;
    else return;
    e.preventDefault();
  }
</script>

<div class="slider" class:disabled>
  <span class="label">{label}</span>
  <div
    bind:this={track}
    class="track"
    style:--c={color}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)}
    aria-disabled={disabled}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    ondblclick={() => (value = defaultValue)}
    onkeydown={key}
  >
    <div class="fill" style:width="{value * 100}%">
      {#if value > 0.04}
        <span class="grip"><i></i><i></i><i></i></span>
      {/if}
    </div>
  </div>
</div>

<style>
  .slider { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .label { color: var(--muted); }
  .track {
    position: relative;
    height: 28px;
    border: 2px solid var(--c);
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }
  .fill { position: relative; height: 100%; background: var(--c); }
  .grip {
    position: absolute;
    right: 6px;
    top: 50%;
    translate: 0 -50%;
    display: flex;
    gap: 2px;
  }
  .grip i { display: block; width: 1px; height: 8px; background: var(--bg); }
  .disabled { opacity: 0.3; }
  .disabled .track { cursor: default; }
</style>
