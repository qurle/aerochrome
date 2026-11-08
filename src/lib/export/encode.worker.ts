/// <reference lib="webworker" />
import encode from '@jsquash/jpeg/encode';
import { displayP3Profile, embedIcc } from './icc';

export interface EncodeRequest {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  quality: number;
  p3: boolean;
}

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { pixels, width, height, quality, p3 } = e.data;
  try {
    const buf = await encode(new ImageData(pixels, width, height), {
      quality,
      progressive: false,
      optimize_coding: true,
      auto_subsample: false,
      chroma_subsample: 1, // 4:4:4, no colour resolution loss
    });
    let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(buf);
    if (p3) bytes = embedIcc(bytes, displayP3Profile());
    (self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
