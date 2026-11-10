<script lang="ts">
  import { cubicOut } from 'svelte/easing';

  let {
    label,
    busyLabel = label,
    checked,
    color,
    note = '',
    busy = false,
    error = false,
    title,
    onchange,
  }: {
    label: string;
    /** Shown while busy; letters it shares with `label` stay put, the rest fade in. */
    busyLabel?: string;
    checked: boolean;
    color: string;
    /** Short status after the label (download size, progress…). */
    note?: string;
    /** Work in progress: the label switches to `busyLabel` and shimmers. */
    busy?: boolean;
    error?: boolean;
    title?: string;
    onchange: (checked: boolean) => void;
  } = $props();

  // Key each letter by its place in `label`, matching `busyLabel` against it in
  // order, so "Detect foliage" → "Detecting foliage…" only adds "ing" and "…".
  const letters = $derived.by(() => {
    if (!busy) return [...label].map((ch, i) => ({ ch, key: `l${i}` }));
    let j = 0;
    return [...busyLabel].map((ch, i) => (j < label.length && ch === label[j] ? { ch, key: `l${j++}` } : { ch, key: `b${i}` }));
  });

  /**
   * Letters fade in and out while their width grows or shrinks, so the rest of
   * the label glides aside both ways instead of jumping once a letter is gone.
   */
  function letter(node: Element) {
    const w = node.getBoundingClientRect().width;
    return { duration: 260, easing: cubicOut, css: (t: number) => `opacity: ${t}; width: ${t * w}px; translate: 0 ${(1 - t) * 4}px` };
  }
</script>

<button class="toggle" role="switch" aria-checked={checked} aria-busy={busy} aria-label={label} style:--c={color} {title} onclick={() => onchange(!checked)}>
  <span class="label" class:busy aria-hidden="true">
    {#each letters as l, i (l.key)}
      <span class="ch" style:--i={i} transition:letter>{l.ch}</span>
    {/each}
  </span>
  <span class="note" class:error aria-live="polite">{note}</span>
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
  .label { color: var(--muted); white-space: pre; transition: color 0.3s var(--ease); }
  .ch { display: inline-block; overflow: hidden; vertical-align: top; }
  /* Working: the label darkens and a shimmer runs across it, letter by letter. */
  .label.busy { color: var(--ink); }
  .busy .ch { animation: shimmer 1.6s ease-in-out infinite; animation-delay: calc(var(--i) * 50ms); }
  @keyframes shimmer { 0%, 60%, 100% { opacity: 1; } 30% { opacity: 0.3; } }
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
