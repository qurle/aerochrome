<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '../lib/editor.svelte';
  import { Renderer } from '../lib/gl/renderer';
  import { cropRegion } from '../lib/image/crop';
  import { decodeFull } from '../lib/image/load';
  import Button from './Button.svelte';

  const img = editor.image!;
  const W = img.width, H = img.height;

  let stage: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer | null = null;
  let full: ImageBitmap | null = null;
  let lutReady = $state(false);
  let rendererReady = $state(false);

  // View transform: `s` = CSS px per image px, (x, y) = image top-left in CSS px.
  let vw = $state(window.innerWidth), vh = $state(window.innerHeight);
  let s = $state(1), x = $state(0), y = $state(0);
  const dpr = () => window.devicePixelRatio || 1;
  // Room kept free for the controls at "fit" (desktop only; on phones they overlay).
  const pads = () => (vw < 860 ? { x: 0, t: 0, b: 0 } : { x: 24, t: 72, b: 72 });
  const fitScale = () => { const p = pads(); return Math.min((vw - p.x * 2) / W, (vh - p.t - p.b) / H); };
  const maxScale = () => Math.max(fitScale(), 4 / dpr()); // up to 400% of device pixels
  const atFit = $derived(s <= fitScale() * 1.001);

  function clampView() {
    const iw = W * s, ih = H * s;
    x = iw <= vw ? (vw - iw) / 2 : Math.min(0, Math.max(vw - iw, x));
    const p = pads();
    y = ih <= vh - p.t - p.b ? p.t + (vh - p.t - p.b - ih) / 2
      : ih <= vh ? (vh - ih) / 2 : Math.min(0, Math.max(vh - ih, y));
  }
  function fit() {
    s = fitScale();
    clampView();
  }
  function zoomTo(next: number, cx: number, cy: number) {
    next = Math.min(maxScale(), Math.max(fitScale(), next));
    x = cx - ((cx - x) * next) / s;
    y = cy - ((cy - y) * next) / s;
    s = next;
    clampView();
  }
  /** Toggle between fit and 100% (one image pixel per device pixel) around a point. */
  function toggleZoom(cx = vw / 2, cy = vh / 2) {
    if (atFit) zoomTo(Math.min(maxScale(), Math.max(1 / dpr(), fitScale() * 2)), cx, cy);
    else fit();
  }

  // --- Rendering: fast pass from the preview while moving, sharp full-res crop when idle.
  let raf = 0;
  let detailTimer = 0;
  let detailKey = '';
  let detailRect: number[] | null = null;
  let interacting = false;

  function visible() {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(vw, x + W * s), y1 = Math.min(vh, y + H * s);
    const view = [(x0 - x) / (W * s), (y0 - y) / (H * s), (x1 - x) / (W * s), (y1 - y) / (H * s)];
    const bw = Math.max(1, Math.round((x1 - x0) * dpr())), bh = Math.max(1, Math.round((y1 - y0) * dpr()));
    return { x0, y0, w: x1 - x0, h: y1 - y0, bw, bh, view, key: `${view.map((n) => n.toFixed(5)).join()}|${bw}x${bh}` };
  }

  /** `sharp`: allowed to crop a new full-resolution region (only when idle). */
  function draw(sharp: boolean) {
    if (!renderer || !lutReady) return;
    const v = visible();
    canvas.style.left = `${v.x0}px`;
    canvas.style.top = `${v.y0}px`;
    canvas.style.width = `${v.w}px`;
    canvas.style.height = `${v.h}px`;
    if (canvas.width !== v.bw || canvas.height !== v.bh) { canvas.width = v.bw; canvas.height = v.bh; }
    const params = editor.params(editor.comparing);

    // Does the preview have enough pixels for this view? If so, no detail pass needed.
    const needsDetail = !!full && (v.view[2] - v.view[0]) * img.preview.width < v.bw * 0.95;
    if (needsDetail && v.key !== detailKey && sharp) {
      // Crop the visible region (plus a margin for sharpen, fringes and edges) from
      // the original, scaled to no more than the canvas resolution.
      const big = Math.max(W, H);
      const margin = Math.ceil(16 + Math.max(params.aberration, params.prism) * 0.25 * big + (params.edge > 0 ? 0.006 * big : 0));
      const sx = Math.max(0, Math.floor(v.view[0] * W) - margin), sy = Math.max(0, Math.floor(v.view[1] * H) - margin);
      const ex = Math.min(W, Math.ceil(v.view[2] * W) + margin), ey = Math.min(H, Math.ceil(v.view[3] * H) + margin);
      const k = Math.min(1, v.bw / ((v.view[2] - v.view[0]) * W));
      renderer.setDetail(cropRegion(full!, sx, sy, ex - sx, ey - sy,
        Math.max(1, Math.round((ex - sx) * k)), Math.max(1, Math.round((ey - sy) * k))));
      detailRect = [sx / W, sy / H, ex / W, ey / H];
      detailKey = v.key;
    }
    if (needsDetail && v.key === detailKey && detailRect) {
      renderer.renderView(params, [W, H], v.view, detailRect);
    } else {
      renderer.renderView(params, [W, H], v.view);
      if (needsDetail) scheduleDetail();
    }
  }

  function scheduleDetail() {
    clearTimeout(detailTimer);
    detailTimer = window.setTimeout(() => { if (!interacting) draw(true); }, 140);
  }

  function request() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => draw(false));
  }

  // Re-render on any change of transform, settings or LUT.
  $effect(() => {
    void [s, x, y, vw, vh, lutReady, editor.lutVersion, editor.comparing, editor.strength, editor.sharpen, editor.film, editor.seed];
    request();
  });

  // Keep the LUT in sync with the selected preset.
  $effect(() => {
    const id = editor.presetId;
    if (!rendererReady || !renderer) return;
    void editor.lutFor(id, renderer.space).then((lut) => {
      if (renderer && id === editor.presetId) { renderer.setLut(lut); lutReady = true; request(); }
    });
  });

  // --- Gestures: drag to pan, pinch / wheel / double-tap to zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; scale: number; mx: number; my: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  let down = { t: 0, x: 0, y: 0, moved: false };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function pointerdown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    stage.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    interacting = true;
    if (pointers.size === 1) down = { t: performance.now(), x: p.x, y: p.y, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: s, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  }

  function pointermove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (Math.hypot(p.x - down.x, p.y - down.y) > 6) down.moved = true;
    if (pointers.size === 1) {
      x += p.x - prev.x;
      y += p.y - prev.y;
      clampView();
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      x += mx - pinch.mx;
      y += my - pinch.my;
      pinch.mx = mx; pinch.my = my;
      zoomTo(pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), mx, my);
    }
  }

  function pointerup(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      interacting = false;
      const now = performance.now();
      if (!down.moved && now - down.t < 300) {
        if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
          toggleZoom(p.x, p.y);
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: p.x, y: p.y };
        }
      }
      request();
      scheduleDetail();
    }
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const p = local(e);
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const k = e.ctrlKey ? 0.012 : 0.0018;
    interacting = true;
    zoomTo(s * Math.exp(-e.deltaY * k), p.x, p.y);
    interacting = false;
    scheduleDetail();
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') editor.closeFullscreen();
    else if (e.key === '+' || e.key === '=') zoomTo(s * 1.5, vw / 2, vh / 2);
    else if (e.key === '-') zoomTo(s / 1.5, vw / 2, vh / 2);
    else if (e.key === '0') fit();
    else if (e.key === '1') zoomTo(1 / dpr(), vw / 2, vh / 2);
    else return;
    e.preventDefault();
  }

  const hold = (on: boolean) => () => (editor.comparing = on);

  onMount(() => {
    try {
      renderer = new Renderer(canvas);
      renderer.setSource(img.preview);
      rendererReady = true;
    } catch (e) {
      editor.error = (e as Error).message;
      editor.closeFullscreen();
      return;
    }
    fit();
    const ro = new ResizeObserver(() => {
      const wasFit = atFit;
      vw = stage.clientWidth; vh = stage.clientHeight;
      if (wasFit) fit(); else clampView();
    });
    ro.observe(stage);
    // Stop iOS Safari from zooming the page instead of the photo.
    const noGesture = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', noGesture);
    document.body.style.overflow = 'hidden';
    let alive = true;
    void decodeFull(img.file).then((bmp) => {
      if (alive) { full = bmp; scheduleDetail(); } else bmp.close();
    }).catch(() => { /* keep using the preview */ });
    return () => {
      alive = false;
      ro.disconnect();
      document.removeEventListener('gesturestart', noGesture);
      document.body.style.overflow = '';
      clearTimeout(detailTimer);
      cancelAnimationFrame(raf);
      full?.close();
      renderer?.dispose();
      editor.comparing = false;
    };
  });
</script>

<svelte:window onkeydown={key} />

<div
  class="fullscreen"
  role="dialog"
  aria-modal="true"
  aria-label="Fullscreen view"
  tabindex="-1"
  bind:this={stage}
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={pointerup}
  onwheel={wheel}
>
  <canvas bind:this={canvas}></canvas>

  <div class="top">
    <Button size="sm" onclick={() => editor.closeFullscreen()}>Close</Button>
  </div>
  <div class="bottom">
    <Button size="sm" label="Hold to see the original" onpointerdown={hold(true)} onpointerup={hold(false)}>
      {editor.comparing ? 'Original' : 'Hold for original'}
    </Button>
  </div>
</div>

<style>
  .fullscreen {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: var(--bg);
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    outline: none;
  }
  .fullscreen:active { cursor: grabbing; }
  canvas { position: absolute; display: block; }
  .top, .bottom {
    position: absolute;
    display: flex;
    gap: 8px;
  }
  .top { top: max(16px, env(safe-area-inset-top)); right: 16px; }
  .bottom {
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 50%;
    translate: -50% 0;
  }
</style>
