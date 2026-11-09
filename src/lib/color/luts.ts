import { LUT_SIZE } from './lut';
import type { LutRequest } from './lut.worker';
import type { WorkingSpace } from './spaces';

/** Bakes LUTs off the main thread and caches them by preset, space and size. */
export class LutCache {
  private worker: Worker | null = null;
  private done = new Map<string, Float32Array>();
  private waiting = new Map<string, Promise<Float32Array>>();
  private resolvers = new Map<string, (d: Float32Array) => void>();

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./lut.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; data: Float32Array }>) => {
        this.done.set(e.data.key, e.data.data);
        this.waiting.delete(e.data.key);
        this.resolvers.get(e.data.key)?.(e.data.data);
        this.resolvers.delete(e.data.key);
      };
    }
    return this.worker;
  }

  get(id: string, space: WorkingSpace, size = LUT_SIZE): Promise<Float32Array> {
    const key = `${id}|${space}|${size}`;
    const hit = this.done.get(key);
    if (hit) return Promise.resolve(hit);
    let p = this.waiting.get(key);
    if (!p) {
      p = new Promise<Float32Array>((res) => this.resolvers.set(key, res));
      this.waiting.set(key, p);
      this.getWorker().postMessage({ key, id, space, size } satisfies LutRequest);
    }
    return p;
  }
}
