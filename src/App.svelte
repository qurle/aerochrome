<script lang="ts">
  import Button from './components/Button.svelte';
  import Fullscreen from './components/Fullscreen.svelte';
  import Help from './components/Help.svelte';
  import Slider from './components/Slider.svelte';
  import Thumb from './components/Thumb.svelte';
  import Viewer from './components/Viewer.svelte';
  import { DEFAULTS, editor } from './lib/editor.svelte';
  import { GROUPS, groupOf } from './lib/presets';

  let input: HTMLInputElement;
  let dragging = $state(false);
  let pager: HTMLDivElement;
  let page = $state(0);
  let helpOpen = $state(false);
  /** Preset list scrolled away from the top: show the top fade. */
  let listScrolled = $state(false);
  /** More of the list below: show the bottom fade. */
  let listMore = $state(true);
  const listScroll = (el: HTMLElement) => {
    listScrolled = el.scrollTop > 2;
    listMore = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  };
  // Also on load and resize: a list that fits needs no bottom fade.
  $effect(() => {
    if (!listEl) return;
    const ro = new ResizeObserver(() => listScroll(listEl));
    ro.observe(listEl);
    for (const child of listEl.children) ro.observe(child);
    return () => ro.disconnect();
  });
  let listEl: HTMLDivElement;

  // Keep the selected preset's group in view when presets change by keyboard
  // or swipe (clicked thumbnails are already visible, so this is a no-op then).
  $effect(() => {
    void editor.presetId;
    requestAnimationFrame(() => {
      const thumb = listEl?.querySelector('.thumb.selected');
      const group = thumb?.closest('.group') as HTMLElement | null;
      if (!listEl || !group || listEl.scrollHeight <= listEl.clientHeight) return;
      const fade = 28; // room for the top/bottom fades
      const box = listEl.getBoundingClientRect(), g = group.getBoundingClientRect();
      let top = listEl.scrollTop;
      if (g.top < box.top + fade) top += g.top - box.top - fade;
      else if (g.bottom > box.bottom - fade) top += g.bottom - box.bottom + fade;
      else return;
      listEl.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  });

  const group = $derived(groupOf(editor.presetId));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  $effect(() => {
    const mq = matchMedia('(max-width: 860px)');
    const on = () => (mobile = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
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
  /**
   * Show a shortcut as a button press: the matching button scales down and
   * back over 500 ms; on the sample (no such button) the photo does.
   */
  function press(label: 'Copy' | 'Export') {
    if (!editor.image || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const btn = [...document.querySelectorAll<HTMLElement>(`section button[title^="${label}"]`)].find((b) => b.offsetParent);
    const el = btn ?? document.querySelector<HTMLElement>('section .image');
    el?.animate(
      [{ transform: 'scale(1)' }, { transform: `scale(${btn ? 0.92 : 0.97})` }, { transform: 'scale(1)' }],
      { duration: 500, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }

  // Shortcuts match physical keys (KeyboardEvent.code), so they work in any
  // layout: T is the same key on Russian ЙЦУКЕН (Е) as on QWERTY.
  function key(e: KeyboardEvent, down: boolean) {
    // Hold \ to compare with the original, like in photo editors.
    if (e.code === 'Backslash' && editor.image) { editor.comparing = down; return; }
    // Esc drops keyboard focus (fullscreen and the help dialog close on their own).
    if (down && e.code === 'Escape' && !helpOpen && !editor.fullscreen) {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body) a.blur();
      return;
    }
    if (!down || typing(e) || e.altKey || helpOpen) return;
    // "?" is Shift+/ on QWERTY; also accept layouts that type "?" elsewhere.
    if ((e.code === 'Slash' && e.shiftKey) || e.key === '?') { helpOpen = true; e.preventDefault(); return; }
    const cmd = e.metaKey || e.ctrlKey;
    const c = e.code;
    if (cmd) {
      if (c === 'KeyC' && !getSelection()?.toString()) { press('Copy'); editor.copy(); }
      else if (c === 'KeyE' || c === 'KeyS') { press('Export'); void (editor.pending ? editor.savePending() : editor.exportJpeg()); }
      else if (c === 'KeyO') open();
      else return;
    } else if (c === 'ArrowRight') editor.step(1);
    else if (c === 'ArrowLeft') editor.step(-1);
    else if (c === 'ArrowDown') editor.stepGroup(1);
    else if (c === 'ArrowUp') editor.stepGroup(-1);
    else if (c === 'KeyO') open();
    else if (c === 'KeyF') editor.fullscreen ? editor.closeFullscreen() : editor.openFullscreen();
    else if (c === 'KeyT') editor.setTweak(e.shiftKey ? DEFAULTS.tweak : Math.floor(Math.random() * 101));
    else return;
    e.preventDefault();
  }


  // --- Presets pane (mobile): follows the finger, settles with momentum.
  // Progress p: 0 = open, 1 = collapsed. The stage height is driven from here;
  // while it moves, the photo is only CSS-scaled (editor.gesturing) and
  // re-rendered once when the pane settles.
  let mainH = $state(window.innerHeight);
  let mobile = $state(matchMedia('(max-width: 860px)').matches);
  let paneP = $state(0);
  let paneTr = $state('none');
  // env() can't be read from JS directly; measure it with a probe element.
  const sab = (() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.append(el);
    const v = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    el.remove();
    return v;
  })();
  const safeBottom = () => sab;
  const openH = $derived(Math.min(mainH * 0.58, 620));
  const closedH = $derived(mainH - 64 - safeBottom());
  const stageH = $derived(openH + (closedH - openH) * paneP);

  let drag = $state.raw<{ y: number; p0: number; samples: { t: number; y: number }[] } | null>(null);
  let settling = $state(false);
  let settleTimer = 0;
  let settleToken = 0;
  /** Collapsed is derived from the pane's actual position, so it can never disagree with it. */
  const collapsed = $derived(paneP >= 1 && !drag && !settling);
  function handleDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    clearTimeout(settleTimer);
    settleToken++;
    settling = false;
    drag = { y: e.clientY, p0: paneP, samples: [{ t: performance.now(), y: e.clientY }] };
    paneTr = 'none';
    editor.gesturing = true;
  }
  function handleMove(e: PointerEvent) {
    if (!drag) return;
    const span = closedH - openH;
    let p = drag.p0 + (e.clientY - drag.y) / span;
    // Rubber-band slightly past either end.
    if (p < 0) p = -0.15 * (1 - 1 / (1 + -p * 2));
    if (p > 1) p = 1 + 0.15 * (1 - 1 / (1 + (p - 1) * 2));
    paneP = p;
    const samples = [...drag.samples, { t: performance.now(), y: e.clientY }];
    while (samples.length > 2 && samples[samples.length - 1].t - samples[0].t > 100) samples.shift();
    drag = { ...drag, samples };
  }
  function handleUp(e: PointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const a = drag.samples[0], b = drag.samples[drag.samples.length - 1];
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px per ms, + = down
    const tap = Math.abs(dy) < 6;
    drag = null;
    const target = tap ? (paneP < 0.5 ? 1 : 0) : Math.abs(v) > 0.4 ? (v > 0 ? 1 : 0) : paneP > 0.5 ? 1 : 0;
    settle(target, v);
  }
  function settle(target: 0 | 1, v = 0) {
    const dist = Math.abs(target - paneP) * (closedH - openH);
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0
      : Math.round(Math.min(340, Math.max(170, dist / Math.max(Math.abs(v), 1.1))));
    paneTr = ms ? `${ms}ms cubic-bezier(0.2, 0.85, 0.25, 1)` : 'none';
    paneP = target;
    settling = true;
    clearTimeout(settleTimer);
    const token = ++settleToken;
    settleTimer = window.setTimeout(() => {
      if (token !== settleToken) return; // a newer gesture took over
      settling = false;
      paneTr = 'none';
      editor.gesturing = false;
    }, ms + 30);
  }
  function scrolled() {
    page = Math.round(pager.scrollLeft / (pager.scrollWidth - pager.clientWidth || 1));
  }
  const goTo = (i: number) => pager.scrollTo({ left: i * pager.scrollWidth, behavior: 'smooth' });

  /** Busy state as the UI shows it: a copy stays invisible for its first 500 ms. */
  const shown = $derived(editor.busy?.quiet ? null : editor.busy);
  const exportLabel = $derived.by(() => {
    const b = shown;
    if (editor.pending) return 'Save';
    if (b?.kind === 'export') return `${Math.round((b.progress ?? 0) * 100)}%`;
    if (b?.kind === 'encode') return 'Saving…';
    return 'Export';
  });
  const copyLabel = $derived(
    shown?.kind === 'copy' ? `${Math.round((shown.progress ?? 0) * 100)}%` :
    shown?.kind === 'copied' ? 'Copied' : 'Copy');
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
  onpopstate={() => editor.onPopState()}
/>

{#if editor.fullscreen && editor.image}<Fullscreen />{/if}
<Help bind:open={helpOpen} />
<button class="help" aria-label="About and shortcuts" title="About and shortcuts (?)" onclick={() => (helpOpen = true)}>?</button>

<input bind:this={input} type="file" accept="image/*,.heic,.heif" hidden onchange={picked} />

<main
  class:dragging
  class:collapsed
  bind:clientHeight={mainH}
  style:--p={Math.min(1, Math.max(0, paneP))}
  style:--pane-tr={paneTr === 'none' ? 'none' : `opacity ${paneTr}`}
>
  <section
    class="stage"
    style:height={mobile ? `${stageH}px` : null}
    style:transition={mobile && paneTr !== 'none' ? `height ${paneTr}` : null}
  >
    <Viewer onopen={open}>
      {#snippet top()}
        <div class="desktop" class:invisible={editor.isSample || (editor.samplePending && !editor.image)}><Button title="Open (O)" onclick={open}>Open</Button></div>
      {/snippet}
      {#snippet bottom()}
        <div class="actions">
          {#if editor.isSample || (editor.samplePending && !editor.image)}
            <!-- Sample: one action, open your own photo. Copy and export still
                 work on the sample through their shortcuts. -->
            <span class="spacer"></span>
            <Button variant="accent" title="Open (O)" onclick={open}>Open your photo</Button>
            <span class="spacer"></span>
          {:else}
            <span class="mobile"><Button onclick={open}>Open</Button></span>
            <span class="spacer"></span>
            <span class="desktop">
              <Button variant="outline-accent" title="Copy ({mod}C)" disabled={noImage || !!shown} onclick={() => editor.copy()}>{copyLabel}</Button>
            </span>
            <Button variant="accent" title="Export ({mod}E)" disabled={noImage || (!!shown && !editor.pending)} onclick={exportClick}>{exportLabel}</Button>
          {/if}
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
      onpointermove={handleMove}
      onpointerup={handleUp}
      onpointercancel={handleUp}
    >
      <i></i>
      <span class="current"><span class="label">{group.name}</span> {editor.preset.name}</span>
    </button>
    <div class="pager" bind:this={pager} onscroll={scrolled}>
      <div class="page presets" class:scrolled={listScrolled} class:more={listMore}>
        <div class="scroll" bind:this={listEl} onscroll={(e) => listScroll(e.currentTarget as HTMLElement)}>
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
          defaultValue={DEFAULTS.tweak / 100}
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
  .invisible { visibility: hidden; }
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
  .presets::before {
    content: '';
    position: absolute;
    left: 0; right: 0; top: 0;
    height: 24px;
    background: linear-gradient(var(--bg), transparent);
    pointer-events: none;
    z-index: 1;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .presets.scrolled::before { opacity: 1; }
  .presets::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 24px;
    background: linear-gradient(transparent, var(--bg));
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .presets.more::after { opacity: 1; }
  /* Scroll containers clip their overflow, which would crop the keyboard
     focus ring (2px + 2px offset) at the edges. 6px of padding with a
     matching negative margin gives it room without moving anything. */
  .scroll {
    height: calc(100% + 6px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: -6px -6px 0;
    padding: 6px 6px 24px;
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

  /* Quiet "?" in a corner: bottom left on desktop, top right on phones. */
  .help {
    position: fixed;
    left: 8px;
    bottom: 8px;
    z-index: 5;
    padding: 12px 16px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
    border-radius: var(--r-button); /* gives the focus ring a soft shape */
    transition: color 0.2s var(--ease), outline-color 0.18s var(--ease), outline-offset 0.18s var(--ease);
  }
  .help:hover { color: var(--ink); }

  .mobile { display: none; }
  .dots { justify-content: center; gap: 8px; padding: 16px 0 24px; }
  .dots button { width: 6px; height: 6px; padding: 0; border: 0; background: var(--line); cursor: pointer; }
  .dots button.on { background: var(--ink); }

  @media (max-width: 860px) {
    .help { left: auto; bottom: auto; right: 4px; top: max(4px, env(safe-area-inset-top)); }
    main { flex-direction: column; height: 100svh; min-height: 0; }
    .desktop { display: none; }
    .mobile { display: flex; }
    .stage {
      flex: none;
      padding: max(24px, env(safe-area-inset-top)) 16px 24px;
    }
    main.collapsed .pager, main.collapsed .dots { display: none; }
    .pager, .dots { opacity: clamp(0, calc(1 - var(--p) * 1.8), 1); transition: var(--pane-tr); }
    .handle .current {
      position: absolute;
      top: 28px;
      left: 0;
      right: 0;
      text-align: center;
      pointer-events: none;
      opacity: clamp(0, calc((var(--p) - 0.45) * 2.5), 1);
      transition: var(--pane-tr);
    }
    .handle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      position: relative;
      width: 100%;
      height: 34px;
      margin-top: -10px;
      padding: 10px 16px 0;
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
    /* Same ring room as the list; widened by the padding so content width stays put. */
    .page.sliders { width: calc(100% - 28px); justify-content: flex-start; gap: 14px; overflow-y: auto; margin: -6px; padding: 6px 6px 14px; }
    .dots { padding: 12px 0 max(16px, env(safe-area-inset-bottom)); }
  }
</style>
