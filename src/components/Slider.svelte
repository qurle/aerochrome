<script lang="ts">
  let {
    label,
    value = $bindable(),
    color,
    defaultValue = 0,
    disabled = false,
    steps = 0,
    editable = false,
  }: {
    label: string;
    value: number;
    color: string;
    defaultValue?: number;
    disabled?: boolean;
    /** Snap to this many steps (0 = continuous). */
    steps?: number;
    /** Show an editable number (0…steps) next to the track. */
    editable?: boolean;
  } = $props();

  let track: HTMLDivElement;
  let dragging = $state(false);

  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const snap = (v: number) => (steps ? Math.round(clamp(v) * steps) / steps : clamp(v));
  const set = (v: number) => { const n = snap(v); if (n !== value) value = n; };
  function setFrom(e: PointerEvent) {
    const r = track.getBoundingClientRect();
    set((e.clientX - r.left) / r.width);
  }
  function typed(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const n = Number(el.value);
    if (Number.isFinite(n)) set(n / (steps || 100));
    el.value = String(Math.round(value * (steps || 100)));
  }
  // Mouse: press and drag as usual. Touch: nothing happens until the finger
  // clearly moves sideways (then it drags) or lifts without moving (a tap sets
  // the value). Vertical swipes are left to the page, so scrolling through the
  // sliders never changes them.
  let touch: { x: number; y: number; id: number } | null = null;
  function down(e: PointerEvent) {
    if (disabled) return;
    if (e.pointerType === 'mouse') {
      dragging = true;
      track.setPointerCapture(e.pointerId);
      setFrom(e);
    } else {
      touch = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }
  }
  function move(e: PointerEvent) {
    if (dragging) { setFrom(e); return; }
    if (!touch) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      dragging = true;
      track.setPointerCapture(touch.id);
      setFrom(e);
    } else if (Math.abs(dy) > 6) {
      touch = null; // vertical: let the page scroll
    }
  }
  function up(e: PointerEvent) {
    if (touch && !dragging && e.type === 'pointerup') setFrom(e); // tap
    touch = null;
    dragging = false;
  }
  function key(e: KeyboardEvent) {
    const step = (steps ? 1 / steps : 0.02) * (e.shiftKey ? 10 : 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - step);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div class="slider" class:disabled>
  <span class="label">{label}</span>
  <div class="row">
  <div
    bind:this={track}
    class="track"
    class:dragging
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
    ondblclick={() => set(defaultValue)}
    onkeydown={key}
  >
    <div class="fill" class:glide={!dragging} style:width="{value * 100}%">
      {#if value > 0.04}
        <span class="grip"><i></i><i></i><i></i></span>
      {/if}
    </div>
  </div>
  {#if editable}
    <input
      class="value"
      style:--c={color}
      type="text"
      inputmode="numeric"
      pattern="[0-9]*"
      maxlength="3"
      aria-label="{label} value"
      value={Math.round(value * (steps || 100))}
      {disabled}
      onchange={typed}
      onkeydown={(e) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLInputElement;
        if (e.key === 'Enter') el.blur();
        else if (e.key === 'Escape') { el.value = String(Math.round(value * (steps || 100))); el.blur(); }
      }}
      onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
    />
  {/if}
  </div>
</div>

<style>
  .slider { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  /* Phones: label beside the track, so all sliders fit under the photo. */
  @media (max-width: 860px) {
    .slider { flex-direction: row; align-items: center; gap: 12px; }
    .label { flex: none; width: 76px; }
    .row { flex: 1; min-width: 0; }
  }
  .label { color: var(--muted); }
  .row { display: flex; gap: 8px; }
  .track {
    flex: 1;
    position: relative;
    height: 28px;
    /* Square at rest; rounded while pressed or dragged. */
    border-radius: 0;
    overflow: hidden;
    cursor: ew-resize;
    touch-action: pan-y;
    user-select: none;
    transition: border-color 0.2s var(--ease), opacity 0.2s var(--ease), border-radius 0.2s var(--ease),
      outline-color 0.18s var(--ease), outline-offset 0.18s var(--ease);
  }
  .track:active, .track.dragging { border-radius: var(--r-control); }
  /* The border is drawn on top, so the fill runs under it to the outer edge:
     two rounded shapes of the same colour side by side leave an anti-aliased
     seam, an overlay doesn't. */
  .track::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--c);
    border-radius: inherit;
    pointer-events: none;
  }
  /* inherit follows the track's radius, including mid-transition. */
  .fill { position: relative; height: 100%; background: var(--c); border-radius: inherit; }
  /* Changes from shortcuts and preset switches glide; dragging tracks the finger. */
  .glide { transition: width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1); }
  @media (prefers-reduced-motion: reduce) { .glide { transition: none; } }
  .grip {
    position: absolute;
    right: 6px;
    top: 50%;
    translate: 0 -50%;
    display: flex;
    gap: 2px;
  }
  .grip i { display: block; width: 1px; height: 8px; background: var(--bg); }
  .value {
    width: 52px;
    height: 28px;
    padding: 0;
    border: 2px solid var(--c);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: center;
    /* Square at rest; rounded while editing. */
    border-radius: 0;
    appearance: none;
    transition: border-color 0.2s var(--ease), color 0.2s var(--ease), border-radius 0.2s var(--ease),
      outline-color 0.18s var(--ease), outline-offset 0.18s var(--ease);
  }
  .value:focus, .value:active { border-radius: var(--r-control); }
  .slider { transition: opacity 0.2s var(--ease); }
  .disabled { opacity: 0.3; }
  .disabled .track { cursor: default; }
</style>
