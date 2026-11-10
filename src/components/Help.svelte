<script lang="ts">
  let { open = $bindable(false) }: { open: boolean } = $props();

  let dialog: HTMLDialogElement;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl';
  const shift = isMac ? '⇧' : 'Shift';
  // Touch-only devices (phones) get no shortcuts table.
  const touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

  type Row = { keys: string[][]; action: string };
  // Each inner array is one key combination; several combinations mean "or".
  const shortcuts: Row[] = [
    // Navigation
    { keys: [['←'], ['→']], action: 'Previous / next preset' },
    { keys: [['↑'], ['↓']], action: 'Same preset in the previous / next group' },
    { keys: [['T']], action: 'Random Tweak' },
    { keys: [[shift, 'T']], action: 'Reset Tweak' },
    // File
    { keys: [['O'], [mod, 'O']], action: 'Open a photo' },
    { keys: [[mod, 'V']], action: 'Paste a photo' },
    { keys: [[mod, 'C']], action: 'Copy image' },
    { keys: [[mod, 'E']], action: 'Export JPEG' },
    // Fullscreen
    { keys: [['F']], action: 'Fullscreen' },
    { keys: [['+'], ['−'], ['0'], ['1']], action: 'Fullscreen: zoom in, out, fit, 100%' },
    { keys: [['Esc']], action: 'Close fullscreen' },
    // Compare
    { keys: [['\\']], action: 'Hold to see the original' },
    // Help
    { keys: [['?']], action: 'This help' },
  ];

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="help-title"
  onclose={() => (open = false)}
  onclick={(e) => { if (e.target === dialog) open = false; }}
>
  <!-- autofocus: opening puts focus on the panel, not on the first link. -->
  <!-- svelte-ignore a11y_autofocus -->
  <div class="panel" tabindex="-1" autofocus>
    <p id="help-title" class="credit">
      made by <a href="https://qurle.net" target="_blank" rel="noopener">qurle</a> feat. claude opus
    </p>
    <p class="about">
      Here you can imitate IR photos in Aerochrome aesthetics. Pick a preset and tune it with the sliders.
    </p>

    {#if !touch}
      <table>
        <tbody>
          {#each shortcuts as row (row.action)}
            <tr>
              <th scope="row">
                {#each row.keys as combo, i (i)}
                  {#if i > 0}<span class="or">{combo.length > 1 || row.keys[i - 1].length > 1 ? 'or' : ''}</span>{/if}<span class="combo">{#each combo as k (k)}<kbd>{k}</kbd>{/each}</span>
                {/each}
              </th>
              <td>{row.action}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <button class="close" onclick={() => (open = false)}>Close</button>
  </div>
</dialog>

<style>
  dialog {
    max-width: min(480px, calc(100vw - 32px));
    max-height: calc(100svh - 32px);
    padding: 0;
    border: 0;
    background: var(--bg);
    color: var(--ink);
    overflow: auto;
  }
  dialog::backdrop { background: rgb(30 14 29 / 0.3); }
  dialog[open] { animation: rise 0.22s cubic-bezier(0.2, 0.85, 0.25, 1); }
  dialog[open]::backdrop { animation: fade 0.22s ease-out; }
  @keyframes rise { from { opacity: 0; translate: 0 12px; } }
  @keyframes fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    dialog[open], dialog[open]::backdrop { animation: none; }
  }

  .panel { display: flex; flex-direction: column; gap: 20px; padding: 32px; outline: none; }
  p { margin: 0; }
  .credit { font-size: 16px; }
  .credit a { color: inherit; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 2px; }
  .about { line-height: 1.45; }

  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { padding: 6px 0; text-align: left; vertical-align: baseline; font-weight: 600; }
  th { padding-right: 20px; white-space: nowrap; }

  .combo { display: inline-flex; gap: 3px; }
  .or { display: inline-block; min-width: 6px; margin: 0 6px; color: var(--muted); font-size: 13px; }
  .or:empty { margin: 0; }
  kbd {
    display: inline-block;
    min-width: 22px;
    padding: 2px 6px;
    background: var(--placeholder);
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    text-align: center;
  }

  .close {
    align-self: flex-start;
    padding: 8px 16px;
    border: 2px solid var(--ink);
    background: transparent;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
</style>
