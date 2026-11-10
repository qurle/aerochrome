import type { SegRequest, SegResponse } from './seg.worker';

/**
 * Scene mask in full-image coordinates, top row first. RGBA8 channels:
 * R vegetation, G forested terrain (mountain, hill), B man-made objects.
 */
export interface SceneMask { data: Uint8Array; width: number; height: number }

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (m: SceneMask) => void; reject: (e: Error) => void }>();
let progressCb: ((f: number) => void) | null = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./seg.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<SegResponse>) => {
    const m = e.data;
    if (m.type === 'progress') { progressCb?.(m.total ? m.loaded / m.total : 0); return; }
    const job = waiting.get(m.id);
    if (!job) return;
    waiting.delete(m.id);
    if (m.type === 'mask') job.resolve({ data: m.data, width: m.width, height: m.height });
    else job.reject(new Error(m.message));
  };
  worker.onerror = (e) => {
    for (const job of waiting.values()) job.reject(new Error(e.message || 'Foliage detection failed'));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Segment a photo. The first call downloads the model (progress 0..1 goes to
 * `onProgress`); later calls reuse it. `image` is copied, the caller keeps it.
 */
export async function detectScene(image: ImageBitmap, onProgress?: (f: number) => void): Promise<SceneMask> {
  const copy = await createImageBitmap(image);
  const id = ++nextId;
  progressCb = onProgress ?? null;
  return new Promise<SceneMask>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const req: SegRequest = { type: 'run', id, image: copy };
    getWorker().postMessage(req, [copy]);
  });
}
