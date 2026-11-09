<script lang="ts">
  import Button from './components/Button.svelte';
  import Fullscreen from './components/Fullscreen.svelte';
  import Slider from './components/Slider.svelte';
  import Thumb from './components/Thumb.svelte';
  import Viewer from './components/Viewer.svelte';
  import { DEFAULTS, editor } from './lib/editor.svelte';
  import { GROUPS, groupOf } from './lib/presets';

  let input: HTMLInputElement;
  let dragging = $state(false);
  let pager: HTMLDivElement;
  let page = $state(0);
  /** Mobile: presets pane dragged down, photo takes the screen. */
  let collapsed = $state(false);
  const group = $derived(groupOf(editor.presetId));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? '⌘' : 'Ctrl+';

  const open = () => input.click();
  function picked() {
    const f = input.files?.[0];
    if (f) void editor.open(f);
    input.value = '';
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name));
    if (f) void editor.open(f);
  }
  function paste(e: ClipboardEvent) {
    const f = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (f) void editor.open(f);
  }
  function typing(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
  }
  function key(e: KeyboardEvent, down: boolean) {
    // Hold "\\" to compare with the original, like in photo editors.
    if (e.key === '\\' && editor.image) { editor.comparing = down; return; }
    if (!down || typing(e) || e.altKey) return;
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (cmd) {
      if (k === 'c' && !getSelection()?.toString()) editor.copy();
      else if (k === 'e' || k === 's') void (editor.pending ? editor.savePending() : editor.exportJpeg());
      else if (k === 'o') open();
      else return;
    } else if (e.key === 'ArrowRight') editor.step(1);
    else if (e.key === 'ArrowLeft') editor.step(-1);
    else if (e.key === 'ArrowDown') editor.stepGroup(1);
    else if (e.key === 'ArrowUp') editor.stepGroup(-1);
    else if (k === 'o') open();
    else if (k === 'f') editor.fullscreen ? editor.closeFullscreen() : editor.openFullscreen();
    else if (k === 't') editor.setTweak(e.shiftKey ? 0 : 1 + Math.floor(Math.random() * 100));
    else return;
    e.preventDefault();
  }

  // Drawer handle: drag down to collapse, up to expand; tap toggles.
  let handleStart: { y: number; t: number } | null = null;
  function handleDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleStart = { y: e.clientY, t: performance.now() };
  }
  function handleUp(e: PointerEvent) {
    if (!handleStart) return;
    const dy = e.clientY - handleStart.y;
    if (dy > 30) collapsed = true;
    else if (dy < -30) collapsed = false;
    else if (Math.abs(dy) < 8) collapsed = !collapsed;
    handleStart = null;
  }
  function scrolled() {
    page = Math.round(pager.scrollLeft / (pager.scrollWidth - pager.clientWidth || 1));
  }
  const goTo = (i: number) => pager.scrollTo({ left: i * pager.scrollWidth, behavior: 'smooth' });

  const exportLabel = $derived.by(() => {
    const b = editor.busy;
    if (editor.pending) return 'Save';
    if (b?.kind === 'export') return `${Math.round((b.progress ?? 0) * 100)}%`;
    if (b?.kind === 'encode') return 'Saving…';
    return 'Export';
  });
  const copyLabel = $derived(
    editor.busy?.kind === 'copy' ? `${Math.round((editor.busy.progress ?? 0) * 100)}%` :
    editor.busy?.kind === 'copied' ? 'Copied' : 'Copy');
  const exportClick = () => (editor.pending ? editor.savePending() : editor.exportJpeg());
  const noImage = $derived(!editor.image);
</script>

<svelte:window
  onpaste={paste}
  onkeydown={(e) => key(e, true)}
  onkeyup={(e) => key(e, false)}
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={(e) => { if (!e.relatedTarget) dragging = false; }}
  ondrop={drop}
  onpopstate={() => (editor.fullscreen = false)}
/>

{#if editor.fullscreen && editor.image}<Fullscreen />{/if}

<input bind:this={input} type="file" accept="image/*,.heic,.heif" hidden onchange={picked} />

<main class:dragging class:collapsed>
  <section class="stage">
    <Viewer onopen={open}>
      {#snippet top()}
        <div class="desktop"><Button title="Open (O)" onclick={open}>Open</Button></div>
      {/snippet}
      {#snippet bottom()}
        <div class="actions">
          <span class="mobile"><Button onclick={open}>Open</Button></span>
          <span class="spacer"></span>
          <span class="desktop">
            <Button variant="outline-accent" title="Copy ({mod}C)" disabled={noImage || !!editor.busy} onclick={() => editor.copy()}>{copyLabel}</Button>
          </span>
          <Button variant="accent" title="Export ({mod}E)" disabled={noImage || (!!editor.busy && !editor.pending)} onclick={exportClick}>{exportLabel}</Button>
        </div>
      {/snippet}
    </Viewer>
    {#if editor.error}<p class="error" role="alert">{editor.error}</p>{/if}
  </section>

  <aside class="settings">
    <button
      class="handle mobile"
      aria-label={collapsed ? 'Show presets' : 'Hide presets'}
      aria-expanded={!collapsed}
      onpointerdown={handleDown}
      onpointerup={handleUp}
      onpointercancel={() => (handleStart = null)}
    >
      <i></i>
      {#if collapsed}<span class="current"><span class="label">{group.name}</span> {editor.preset.name}</span>{/if}
    </button>
    <div class="pager" bind:this={pager} onscroll={scrolled}>
      <div class="page presets">
        <div class="scroll">
          {#each GROUPS as group (group.id)}
            <div class="group">
              <span class="label">{group.name}</span>
              <div class="previews">
                {#each group.presets as p (p.id)}
                  <Thumb
                    label="{group.name} {p.name}"
                    bitmap={editor.thumbs[p.id]}
                    selected={editor.presetId === p.id}
                    onclick={() => editor.select(p.id)}
                  />
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
      <div class="page sliders">
        <div class="current"><span class="label">{group.name}</span> {editor.preset.name}</div>
        <Slider
          label="Tweak"
          color="var(--violet)"
          steps={100}
          editable
          bind:value={() => editor.tweak / 100, (v) => editor.setTweak(v * 100)}
          defaultValue={DEFAULTS.tweak}
        />
        <Slider label="Strength" color="var(--coral)" bind:value={editor.strength} defaultValue={DEFAULTS.strength} />
        <Slider label="Sharpen" color="var(--ink)" bind:value={editor.sharpen} defaultValue={DEFAULTS.sharpen} />
        <Slider label="Filmness" color="var(--steel)" bind:value={editor.film} defaultValue={DEFAULTS.film} />
      </div>
    </div>
    <div class="dots mobile" role="tablist">
      {#each ['Presets', 'Adjust'] as name, i (name)}
        <button role="tab" aria-label={name} aria-selected={page === i} class:on={page === i} onclick={() => goTo(i)}></button>
      {/each}
    </div>
  </aside>
</main>

<style>
  main {
    display: flex;
    height: 100svh;
    min-height: 560px;
  }
  main.dragging .stage { outline: 2px solid var(--ink); outline-offset: -16px; }

  .stage {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: clamp(32px, 9vw, 128px);
  }
  .actions { display: flex; flex: 1; gap: 8px; align-items: center; }
  .spacer { flex: 1; }
  .error { margin: 16px 0 0; color: var(--accent); text-align: center; font-size: 14px; }

  .settings {
    flex: none;
    width: 441px;
    border-left: 1px solid var(--line);
    padding: 64px 80px;
    display: flex;
    flex-direction: column;
  }
  .pager { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 64px; }
  .presets { flex: 1; min-height: 0; position: relative; }
  .presets::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 24px;
    background: linear-gradient(transparent, var(--bg));
    pointer-events: none;
  }
  .scroll {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 24px;
    scrollbar-width: none;
  }
  .scroll::-webkit-scrollbar { display: none; }
  .group { display: flex; flex-direction: column; gap: 8px; }
  .label { color: var(--muted); }
  .previews { display: flex; gap: 8px; }
  .sliders { display: flex; flex-direction: column; gap: 16px; flex: none; }
  .current { color: var(--ink); }
  .current .label { margin-right: 4px; }
  .handle { display: none; }

  .mobile { display: none; }
  .dots { justify-content: center; gap: 8px; padding: 16px 0 24px; }
  .dots button { width: 6px; height: 6px; padding: 0; border: 0; background: var(--line); cursor: pointer; }
  .dots button.on { background: var(--ink); }

  @media (max-width: 860px) {
    main { flex-direction: column; height: 100svh; min-height: 0; }
    .desktop { display: none; }
    .mobile { display: flex; }
    .stage {
      flex: none;
      height: min(58svh, 620px);
      padding: max(24px, env(safe-area-inset-top)) 16px 24px;
      transition: height 0.3s cubic-bezier(0.3, 0.7, 0.2, 1);
    }
    main.collapsed .stage { height: calc(100svh - 64px - env(safe-area-inset-bottom)); }
    main.collapsed .pager, main.collapsed .dots { display: none; }
    .handle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 0 16px 16px;
      border: 0;
      background: transparent;
      touch-action: none;
      cursor: grab;
    }
    .handle i { display: block; width: 40px; height: 4px; background: var(--line); }
    .stage :global(.frame) { width: 100% !important; }
    .stage :global(.image) { align-self: center; }
    .settings {
      width: 100%;
      flex: 1;
      min-height: 0;
      border-left: 0;
      border-top: 1px solid var(--line);
      padding: 10px 0 0;
    }
    .pager {
      flex-direction: row;
      gap: 24px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      padding: 0 16px;
      scroll-padding: 0 16px;
      scrollbar-width: none;
    }
    .pager::-webkit-scrollbar { display: none; }
    .page { flex: none; width: calc(100% - 40px); height: 100%; scroll-snap-align: start; }
    .sliders { justify-content: flex-start; }
    .dots { padding: 12px 0 max(16px, env(safe-area-inset-bottom)); }
  }
</style>
