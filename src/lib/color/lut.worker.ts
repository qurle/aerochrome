/// <reference lib="webworker" />
import { findPreset } from '../presets';
import { buildLut } from './lut';
import type { WorkingSpace } from './spaces';

export interface LutRequest { key: string; id: string; space: WorkingSpace; size: number }

// Presets can hold functions (custom looks), so the worker imports them itself
// and only receives the preset id.
self.onmessage = (e: MessageEvent<LutRequest>) => {
  const { key, id, space, size } = e.data;
  const data = buildLut(findPreset(id).look, space, size);
  (self as unknown as Worker).postMessage({ key, data }, [data.buffer]);
};
