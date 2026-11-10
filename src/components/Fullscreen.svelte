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
  /** Toggle between fit and 100% (one image pixel per device pixel) around a point, animated. */
  function toggleZoom(cx = vw / 2, cy = vh / 2) {
    const from = { s, x, y };
    if (atFit) zoomTo(Math.min(maxScale(), Math.max(1 / dpr(), fitScale() * 2)), cx, cy);
    else fit();
    animateZoom(from, { s, x, y });
  }

  // Zoom animation without per-frame WebGL work: animate a CSS transform on
  // whichever rendered frame shows more of the photo (the less zoomed one),
  // then render the final view once and drop the transform.
  type View = { s: number; x: number; y: number };
  let zt = $state({ tx: 0, ty: 0, k: 1 }); // origin: canvas top-left
  let ztTr = $state('none');
  let zoomEnd = 0;
  let pendingZoom: View | null = null;
  const ZOOM_MS = 320;
  // Zoom needs a visible middle; the snappier motion ease front-loads it too much.
  const ZOOM_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

  function animateZoom(from: View, to: View) {
    finishZoom();
    if (reduced() || (from.s === to.s && from.x === to.x && from.y === to.y)) return;
    interacting = true;
    if (to.s > from.s) {
      // Zoom in: keep the current frame and scale it to where the target view lands.
      s = from.s; x = from.x; y = from.y;
      pendingZoom = to;
      const left = Math.max(0, from.x), top = Math.max(0, from.y), k = to.s / from.s;
      requestAnimationFrame(() => {
        ztTr = `transform ${ZOOM_MS}ms ${ZOOM_EASE}`;
        zt = { tx: to.x + (left - from.x) * k - left, ty: to.y + (top - from.y) * k - top, k };
      });
    } else {
      // Zoom out: render the target (wider) view now, start it scaled to the
      // current state, then let it settle.
      s = to.s; x = to.x; y = to.y;
      draw(false);
      const left = Math.max(0, to.x), top = Math.max(0, to.y), k = from.s / to.s;
      ztTr = 'none';
      zt = { tx: from.x + (left - to.x) * k - left, ty: from.y + (top - to.y) * k - top, k };
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ztTr = `transform ${ZOOM_MS}ms ${ZOOM_EASE}`;
        zt = { tx: 0, ty: 0, k: 1 };
      }));
    }
    zoomEnd = window.setTimeout(finishZoom, ZOOM_MS + 40);
  }

  /** Jump to the end of a running zoom animation (also used when a new gesture starts). */
  function finishZoom() {
    clearTimeout(zoomEnd);
    if (!interacting && !pendingZoom && zt.k === 1 && !zt.tx && !zt.ty) return;
    if (pendingZoom) {
      s = pendingZoom.s; x = pendingZoom.x; y = pendingZoom.y;
      pendingZoom = null;
      draw(false); // final content before the transform goes away, same frame
    }
    ztTr = 'none';
    zt = { tx: 0, ty: 0, k: 1 };
    interacting = false;
    scheduleDetail();
  }

  // --- Motion layer: CSS transforms on the already-rendered canvas, so open,
  // close and swipe-to-dismiss cost no WebGL work.
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let m = $state({ tx: 0, ty: 0, scale: 1, op: 1, bg: 0, chrome: 0 });
  let transition = $state('none');
  const EASE = 'cubic-bezier(0.2, 0.85, 0.25, 1)';
  // The main view's photo fades in as this background fades out (and back).
  let fadeMs = $state(0);
  let cw = $state(0), ch = $state(0);
  $effect(() => { editor.fsBg = m.bg; editor.fsFade = fadeMs ? `opacity ${fadeMs}ms ${EASE}` : 'none'; });

  let motionToken = 0;
  function animate(to: Partial<typeof m>, ms: number) {
    ms = reduced() ? 0 : ms;
    const token = ++motionToken;
    transition = ms ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : 'none';
    fadeMs = ms;
    m = { ...m, ...to };
    return new Promise<void>((r) => setTimeout(() => {
      // Drop the transition once done, so later instant changes stay instant.
      if (token === motionToken) { transition = 'none'; fadeMs = 0; }
      r();
    }, ms + 20));
  }

  /** Transform that places the fitted photo over the main view's photo. */
  function fromMain() {
    const main = document.querySelector<HTMLCanvasElement>('section canvas.main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    if (!r.width) return null;
    const fw = W * s, fh = H * s;
    return { tx: r.left + r.width / 2 - (x + fw / 2), ty: r.top + r.height / 2 - (y + fh / 2), scale: r.width / fw };
  }

  let closing = false;
  async function close(dir = 0) {
    if (closing) return;
    closing = true;
    const target = atFit && !dir ? fromMain() : null;
    if (dir) await animate({ ty: dir * vh, scale: 0.9, bg: 0, chrome: 0 }, 220);
    else if (target) await animate({ ...target, bg: 0, chrome: 0 }, 280);
    else await animate({ scale: 0.94, op: 0, bg: 0, chrome: 0 }, 200);
    editor.finishCloseFullscreen();
  }
  $effect(() => { if (editor.fsClosing) void close(); });

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
    cw = v.w; ch = v.h;
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
    void [s, x, y, vw, vh, lutReady, editor.lutVersion, editor.comparing, editor.strength, editor.sharpen, editor.film, editor.tweak];
    request();
  });

  // Show the same LUT as the main view (preset + tweak).
  $effect(() => {
    const lut = editor.currentLut;
    if (!rendererReady || !renderer || !lut) return;
    renderer.setLut(lut);
    lutReady = true;
    request();
  });

  // --- Gestures: drag to pan, pinch / wheel / double-tap to zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; scale: number; mx: number; my: number } | null = null;
  let lastTap = { t: 0, x: 0, y: 0 };
  let down = { t: 0, x: 0, y: 0, moved: false };
  /** Swipe-to-dismiss: vertical drag at fit. */
  let dismissing = false;
  let samples: { t: number; y: number }[] = [];

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function pointerdown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    finishZoom();
    stage.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    interacting = true;
    if (pointers.size === 1) down = { t: performance.now(), x: p.x, y: p.y, moved: false };
    if (pointers.size === 2) {
      if (dismissing) { dismissing = false; void animate({ ty: 0, scale: 1, bg: 1, chrome: 1 }, 200); }
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
    if (pointers.size === 1 && (dismissing || (atFit && Math.abs(p.y - down.y) > 8 && Math.abs(p.y - down.y) > Math.abs(p.x - down.x)))) {
      // Follow the finger; shrink and fade the further it goes.
      dismissing = true;
      const dy = p.y - down.y, k = Math.min(1, Math.abs(dy) / (vh * 0.5));
      samples.push({ t: performance.now(), y: p.y });
      while (samples.length > 2 && samples[samples.length - 1].t - samples[0].t > 100) samples.shift();
      transition = 'none';
      fadeMs = 0;
      motionToken++;
      m = { ...m, tx: (p.x - down.x) * 0.3, ty: dy, scale: 1 - k * 0.15, bg: 1 - k, chrome: 1 - Math.min(1, k * 2) };
      return;
    }
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
    if (pointers.size === 0 && dismissing) {
      dismissing = false;
      interacting = false;
      const a = samples[0], b = samples[samples.length - 1];
      const v = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px per ms
      samples = [];
      const dy = p.y - down.y;
      if (Math.abs(dy) > vh * 0.18 || Math.abs(v) > 0.6) void close(Math.sign(Math.abs(v) > 0.6 ? v : dy) || 1);
      else void animate({ tx: 0, ty: 0, scale: 1, bg: 1, chrome: 1 }, 240);
      return;
    }
    if (pointers.size === 0) {
      interacting = false;
      const now = performance.now();
      if (!down.moved && now - down.t < 300) {
        samples = [];
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
    finishZoom();
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
    else if (e.key === '0') { const from = { s, x, y }; fit(); animateZoom(from, { s, x, y }); }
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
    // Open: start over the main view's photo and grow into place.
    const start = fromMain();
    m = { ...(start ?? { tx: 0, ty: 0, scale: 0.94 }), op: start ? 1 : 0, bg: 0, chrome: 0 };
    requestAnimationFrame(() => requestAnimationFrame(() => void animate({ tx: 0, ty: 0, scale: 1, op: 1, bg: 1, chrome: 1 }, 300)));
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
      clearTimeout(zoomEnd);
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
  style:--bg-a={m.bg}
  style:--chrome={m.chrome}
  style:--fade={transition === 'none' ? 'none' : transition.replace('transform', 'background-color')}
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={pointerup}
  onwheel={wheel}
>
  <canvas
    bind:this={canvas}
    style:transform="translate({m.tx + ((1 - m.scale) * cw) / 2}px, {m.ty + ((1 - m.scale) * ch) / 2}px) scale({m.scale}) translate({zt.tx}px, {zt.ty}px) scale({zt.k})"
    style:opacity={m.op}
    style:transition={ztTr !== 'none' ? ztTr : transition}
  ></canvas>

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
    background: rgb(246 246 246 / var(--bg-a));
    transition: var(--fade);
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
    outline: none;
  }
  .fullscreen:active { cursor: grabbing; }
  canvas { position: absolute; display: block; will-change: transform; transform-origin: 0 0; }
  .top, .bottom { opacity: var(--chrome); transition: var(--fade); }
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
