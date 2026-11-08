import type { EncodeRequest } from './encode.worker';

export function encodeJpeg(req: EncodeRequest): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(new Blob([e.data.bytes], { type: 'image/jpeg' }));
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Encoder failed')); };
    worker.postMessage(req, [req.pixels.buffer]);
  });
}
