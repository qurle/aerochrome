import { LUT_SIZE } from './lut';
import type { LutData, LutRequest } from './lut.worker';
import type { WorkingSpace } from './spaces';
import { SET_SLICES } from './tweak';

export type { LutData } from './lut.worker';

/** Lower runs first. */
export const Priority = { Now: 0, Soon: 1, Background: 2 } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

interface Job { req: LutRequest; priority: Priority; resolve: (d: LutData) => void; promise: Promise<LutData> }

/**
 * Bakes LUTs off the main thread and caches them. The worker gets one slice at
 * a time, so urgent work (the preset just selected) always goes ahead of
 * background preparation within ~one slice. Results are kept within a memory
 * budget, least recently used out first.
 */
export class LutCache {
  private worker: Worker | null = null;
  private done = new Map<string, LutData>();
  private bytes = 0;
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  private sets = new Map<string, Promise<LutData>>();
  private running: Job | null = null;
  private static readonly BUDGET = 48 * 1024 * 1024;

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./lut.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; lut: LutData }>) => {
        const job = this.running!;
        this.running = null;
        this.jobs.delete(e.data.key);
        // Variant slices only live until their set is assembled; the base is kept.
        if (job.req.slice === 0) this.store(e.data.key, e.data.lut);
        job.resolve(e.data.lut);
        this.pump();
      };
    }
    return this.worker;
  }

  private store(key: string, lut: LutData) {
    const old = this.done.get(key);
    if (old) { this.done.delete(key); this.bytes -= old.data.byteLength; }
    this.done.set(key, lut); // Map keeps insertion order: last = most recent
    this.bytes += lut.data.byteLength;
    for (const [k, v] of this.done) {
      if (this.bytes <= LutCache.BUDGET || k === key) break;
      this.done.delete(k);
      this.bytes -= v.data.byteLength;
    }
  }

  private touch(key: string) {
    const hit = this.done.get(key);
    if (hit) { this.done.delete(key); this.done.set(key, hit); }
    return hit;
  }

  private pump() {
    if (this.running || !this.queue.length) return;
    this.queue.sort((a, b) => a.priority - b.priority); // stable: FIFO within a priority
    this.running = this.queue.shift()!;
    this.getWorker().postMessage(this.running.req);
  }

  private slice(id: string, space: WorkingSpace, size: number, slice: number, priority: Priority): Promise<LutData> {
    const key = `${id}|${space}|${size}|${slice}`;
    const hit = this.touch(key);
    if (hit) return Promise.resolve(hit);
    let job = this.jobs.get(key);
    if (job) {
      if (priority < job.priority) job.priority = priority; // promote queued work
      return job.promise;
    }
    let resolve!: (d: LutData) => void;
    const promise = new Promise<LutData>((r) => (resolve = r));
    job = { req: { key, id, space, size, slice }, priority, resolve, promise };
    this.jobs.set(key, job);
    if (priority === Priority.Now) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
    return promise;
  }

  /** Cached base LUT, if ready. */
  peekBase(id: string, space: WorkingSpace, size = LUT_SIZE) {
    return this.touch(`${id}|${space}|${size}|0`);
  }

  /** Cached Tweak set, if ready. */
  peekSet(id: string, space: WorkingSpace, size = LUT_SIZE) {
    return this.touch(`${id}|${space}|${size}|set`);
  }

  /** The preset's look as designed (one cube). */
  base(id: string, space: WorkingSpace, priority: Priority, size = LUT_SIZE) {
    return this.slice(id, space, size, 0, priority);
  }

  /** Base plus all Tweak variants, stacked for the shader to blend. */
  set(id: string, space: WorkingSpace, priority: Priority, size = LUT_SIZE): Promise<LutData> {
    const key = `${id}|${space}|${size}|set`;
    const hit = this.touch(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.sets.get(key);
    if (pending) {
      // Promote its slices if this request is more urgent.
      for (let s = 0; s < SET_SLICES; s++) void this.slice(id, space, size, s, priority);
      this.pump();
      return pending;
    }
    const p = Promise.all(
      Array.from({ length: SET_SLICES }, (_, s) => this.slice(id, space, size, s, priority)),
    ).then((cubes) => {
      const cube = cubes[0].data.length;
      const data = new Uint8Array(cube * SET_SLICES);
      cubes.forEach((c, s) => data.set(c.data, s * cube));
      const lut: LutData = { data, n: size, slices: SET_SLICES };
      this.sets.delete(key);
      this.store(key, lut);
      return lut;
    });
    this.sets.set(key, p);
    this.pump();
    return p;
  }
}
