<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'outline',
    disabled = false,
    onclick,
    children,
  }: {
    variant?: 'outline' | 'outline-accent' | 'accent';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<button class={variant} {disabled} {onclick}>{@render children()}</button>

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
    transition: opacity 0.15s, background-color 0.15s;
  }
  .outline-accent { border-color: var(--accent); color: var(--accent); }
  .accent { border-color: var(--accent); background: var(--accent); color: var(--bg); }
  button:not(:disabled):active { opacity: 0.8; }
  button:disabled { opacity: 0.3; cursor: default; }
</style>
