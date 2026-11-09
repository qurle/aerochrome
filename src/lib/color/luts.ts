import { LUT_SIZE } from './lut';
import type { LutRequest } from './lut.worker';
import type { WorkingSpace } from './spaces';

interface Job { req: LutRequest; resolve: (d: Float32Array) => void; promise: Promise<Float32Array> }

/**
 * Bakes LUTs off the main thread and caches them by preset, space and size.
 * The worker gets one job at a time so urgent requests (the preset the user just
 * tapped) can jump ahead of background warm-up work.
 */
export class LutCache {
  private worker: Worker | null = null;
  private done = new Map<string, Float32Array>();
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  private running: Job | null = null;

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./lut.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; data: Float32Array }>) => {
        const job = this.running!;
        this.running = null;
        this.done.set(e.data.key, e.data.data);
        this.jobs.delete(e.data.key);
        job.resolve(e.data.data);
        this.pump();
      };
    }
    return this.worker;
  }

  private pump() {
    if (this.running || !this.queue.length) return;
    this.running = this.queue.shift()!;
    this.getWorker().postMessage(this.running.req);
  }

  /** `urgent` puts the request at the front of the queue. */
  get(id: string, space: WorkingSpace, size = LUT_SIZE, urgent = true): Promise<Float32Array> {
    const key = `${id}|${space}|${size}`;
    const hit = this.done.get(key);
    if (hit) return Promise.resolve(hit);
    let job = this.jobs.get(key);
    if (job) {
      // Already queued in the background: promote it.
      const i = this.queue.indexOf(job);
      if (urgent && i > 0) { this.queue.splice(i, 1); this.queue.unshift(job); }
      return job.promise;
    }
    let resolve!: (d: Float32Array) => void;
    const promise = new Promise<Float32Array>((r) => (resolve = r));
    job = { req: { key, id, space, size }, resolve, promise };
    this.jobs.set(key, job);
    if (urgent) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return promise;
  }
}
