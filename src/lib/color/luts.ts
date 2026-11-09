import { LUT_SIZE } from './lut';
import type { LutRequest } from './lut.worker';
import type { WorkingSpace } from './spaces';
import { TWEAK_NEUTRAL } from './tweak';

interface Job { req: LutRequest; slot?: string; resolve: (d: Float32Array | null) => void; promise: Promise<Float32Array | null> }

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
  /** Tweaked variations are cached too, most recent first, up to a memory budget. */
  private tweaked: string[] = [];
  private tweakedBytes = 0;
  private static readonly TWEAKED_BUDGET = 24 * 1024 * 1024;

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./lut.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; data: Float32Array }>) => {
        const job = this.running!;
        this.running = null;
        this.done.set(e.data.key, e.data.data);
        if (job.req.tweak !== TWEAK_NEUTRAL) {
          this.tweaked.push(e.data.key);
          this.tweakedBytes += e.data.data.byteLength;
          while (this.tweakedBytes > LutCache.TWEAKED_BUDGET && this.tweaked.length > 1) {
            const old = this.tweaked.shift()!;
            this.tweakedBytes -= this.done.get(old)?.byteLength ?? 0;
            this.done.delete(old);
          }
        }
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

  /**
   * `urgent` puts the request at the front of the queue. A `slot` makes newer
   * requests supersede queued ones in the same slot (they resolve to null), so
   * scrubbing a slider doesn't pile up stale work.
   */
  get(id: string, space: WorkingSpace, size = LUT_SIZE, urgent = true, tweak = TWEAK_NEUTRAL, slot?: string): Promise<Float32Array | null> {
    const key = `${id}|${space}|${size}|${tweak}`;
    const hit = this.done.get(key);
    if (hit) return Promise.resolve(hit);
    let job = this.jobs.get(key);
    if (job) {
      // Already queued in the background: promote it.
      const i = this.queue.indexOf(job);
      if (urgent && i > 0) { this.queue.splice(i, 1); this.queue.unshift(job); }
      return job.promise;
    }
    if (slot) {
      this.queue = this.queue.filter((j) => {
        if (j.slot !== slot) return true;
        this.jobs.delete(j.req.key);
        j.resolve(null);
        return false;
      });
    }
    let resolve!: (d: Float32Array | null) => void;
    const promise = new Promise<Float32Array | null>((r) => (resolve = r));
    job = { req: { key, id, space, size, tweak }, slot, resolve, promise };
    this.jobs.set(key, job);
    if (urgent) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return promise;
  }
}
