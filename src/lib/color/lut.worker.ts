/// <reference lib="webworker" />
import { findPreset } from '../presets';
import { buildLut } from './lut';
import type { WorkingSpace } from './spaces';
import { tweakLook } from './tweak';

export interface LutRequest { key: string; id: string; space: WorkingSpace; size: number; tweak: number }

// Presets can hold functions (custom looks), so the worker imports them itself
// and only receives the preset id.
self.onmessage = (e: MessageEvent<LutRequest>) => {
  const { key, id, space, size, tweak } = e.data;
  const data = buildLut(tweakLook(findPreset(id).look, tweak), space, size);
  (self as unknown as Worker).postMessage({ key, data }, [data.buffer]);
};
