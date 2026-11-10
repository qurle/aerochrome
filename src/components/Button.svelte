<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'outline',
    size = 'md',
    disabled = false,
    label,
    title,
    onclick,
    onpointerdown,
    onpointerup,
    children,
  }: {
    variant?: 'outline' | 'outline-accent' | 'accent';
    size?: 'md' | 'sm';
    disabled?: boolean;
    label?: string;
    title?: string;
    onclick?: (e: MouseEvent) => void;
    onpointerdown?: (e: PointerEvent) => void;
    onpointerup?: (e: PointerEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button
  class="{variant} {size}"
  {disabled}
  aria-label={label}
  {title}
  {onclick}
  {onpointerdown}
  {onpointerup}
  onpointercancel={onpointerup}
  onpointerleave={onpointerup}
>{@render children()}</button>

<style>
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 12px 32px;
    border: 2px solid var(--ink);
    background: transparent;
    color: var(--ink);
    white-space: nowrap;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    /* Square at rest; corners round while pressed. */
    border-radius: 0;
    transition:
      opacity 0.2s var(--ease), background-color 0.2s var(--ease), border-color 0.2s var(--ease),
      color 0.2s var(--ease), transform 0.12s ease-out, border-radius 0.2s var(--ease),
      outline-color 0.18s var(--ease), outline-offset 0.18s var(--ease);
  }
  .sm { padding: 8px 16px; font-size: 14px; background: var(--bg); }
  .outline-accent { border-color: var(--accent); color: var(--accent); }
  .accent { border-color: var(--accent); background: var(--accent); color: var(--bg); }
  button:not(:disabled):active { border-radius: var(--r-button); }
  button:disabled { opacity: 0.3; cursor: default; }
</style>
