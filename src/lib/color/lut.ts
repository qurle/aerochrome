import type { Look } from './looks';
import { evalLook } from './looks';
import { makeSpace, toEncoded, toLinear, type WorkingSpace } from './spaces';

export const LUT_SIZE = 33;

/**
 * Bake a look into an N³ RGBA float LUT, indexed r + g·N + b·N².
 * Input and output are encoded (gamma) values in the working space.
 */
export function buildLut(look: Look, ws: WorkingSpace, n = LUT_SIZE): Float32Array {
  const space = makeSpace(ws);
  const out = new Float32Array(n * n * n * 4);
  const lin = new Float32Array(n);
  for (let i = 0; i < n; i++) lin[i] = toLinear(i / (n - 1));
  let o = 0;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const v = evalLook(space, look, [lin[r], lin[g], lin[b]]);
        out[o++] = toEncoded(v[0]);
        out[o++] = toEncoded(v[1]);
        out[o++] = toEncoded(v[2]);
        out[o++] = 1;
      }
  return out;
}
