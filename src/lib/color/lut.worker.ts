/// <reference lib="webworker" />
import { findPreset } from '../presets';
import { buildLut } from './lut';
import type { WorkingSpace } from './spaces';
import { setLooks } from './tweak';

/** One cube of a preset's LUT set: slice 0 is the base look, 1.. are Tweak variants. */
export interface LutRequest { key: string; id: string; space: WorkingSpace; size: number; slice: number }
/** RGBA8 LUT cubes stacked along depth: `slices` cubes of n³ (base first). */
export interface LutData { data: Uint8Array; n: number; slices: number }

// Presets can hold functions (custom looks), so the worker imports them itself
// and only receives the preset id. Output is quantised to 8 bits here, which is
// what the GPU stores, so transfers are 4× smaller. One slice per job keeps
// jobs short, so urgent requests never wait long behind background work.
self.onmessage = (e: MessageEvent<LutRequest>) => {
  const { key, id, space, size: n, slice } = e.data;
  const look = setLooks(findPreset(id).look)[slice];
  const f = buildLut(look, space, n);
  const data = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    data[i] = v > 0 ? (v < 1 ? Math.round(v * 255) : 255) : 0;
  }
  const lut: LutData = { data, n, slices: 1 };
  (self as unknown as Worker).postMessage({ key, lut }, [data.buffer]);
};
