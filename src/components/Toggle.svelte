<script lang="ts">
  let {
    label,
    checked,
    color,
    note = '',
    busy = false,
    error = false,
    title,
    onchange,
  }: {
    label: string;
    checked: boolean;
    color: string;
    /** Short status after the label (download size, progress…). */
    note?: string;
    /** Work in progress: the note pulses. */
    busy?: boolean;
    error?: boolean;
    title?: string;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<button class="toggle" role="switch" aria-checked={checked} style:--c={color} {title} onclick={() => onchange(!checked)}>
  <span class="label">{label}</span>
  <span class="note" class:busy class:error aria-live="polite">{note}</span>
  <span class="box" class:on={checked}><span class="knob"></span></span>
</button>

<style>
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .label { color: var(--muted); }
  .note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    transition: color 0.2s var(--ease);
  }
  .note.error { color: var(--accent); }
  .note.busy { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.45; } }

  /* Like the sliders: square at rest, rounded while pressed; the fill and
     the knob glide. */
  .box {
    flex: none;
    position: relative;
    width: 52px;
    height: 28px;
    border-radius: 0;
    background: transparent;
    transition: background-color 0.28s var(--ease), border-radius 0.2s var(--ease);
  }
  .box::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid var(--c);
    border-radius: inherit;
    pointer-events: none;
  }
  .box.on { background: var(--c); }
  .toggle:active .box { border-radius: var(--r-control); }
  .knob {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 16px;
    height: 16px;
    background: var(--c);
    border-radius: 0;
    transition: translate 0.28s var(--ease), background-color 0.28s var(--ease), border-radius 0.2s var(--ease), scale 0.2s var(--ease);
  }
  .on .knob { translate: 24px 0; background: var(--bg); }
  .toggle:active .knob { border-radius: 4px; scale: 1.12 1; }
</style>
