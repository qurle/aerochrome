// "Tweak": a 0–100 variation dial. 50 is the preset exactly as designed; every
// other value is a reproducible variation (below and above 50 go different ways). Each parameter follows its own smooth
// noise curve, so neighbouring values look alike and scrubbing morphs instead of
// flickering, while far-apart values differ clearly.

import type { Grade, Look } from './looks';

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/** The value at which a look is left exactly as designed. */
export const TWEAK_NEUTRAL = 50;

/** Smooth 1D value noise for channel `k`, zero at the neutral value, roughly within -1..1. */
function curve(k: number, tweak: number) {
  const t = tweak - TWEAK_NEUTRAL;
  const noise = (u: number) => {
    const i = Math.floor(u), f = u - i;
    const s = f * f * (3 - 2 * f);
    return hash(k * 101 + i) * (1 - s) + hash(k * 101 + i + 1) * s;
  };
  // Lattice every ~9 steps: neighbours are close, ten steps away is a new look.
  const u = t / 9;
  return Math.max(-1, Math.min(1, (noise(u) - noise(0)) * 1.25));
}

type NumKey = { [K in keyof Grade]: Grade[K] extends number ? K : never }[keyof Grade];

/** How far each grade parameter may move at full swing. */
const SPAN: Partial<Record<NumKey, number>> = {
  foliageHue: 22,
  foliageChroma: 0.28,
  foliageLift: 0.08,
  skyHue: 18,
  skyDepth: 0.22,
  skyChroma: 0.22,
  cyanHue: 20,
  otherChroma: 0.15,
  tintA: 0.012,
  tintB: 0.012,
  contrast: 0.15,
  blacks: 0.03,
  hueShift: 7,
  saturation: 0.12,
};

const KEYS = Object.keys(SPAN) as NumKey[];

/** Apply variation `t` (0–100) to a look. Pure: same t, same result. */
export function tweakLook(look: Look, t: number): Look {
  if (t === TWEAK_NEUTRAL) return look;
  const g: Grade = { ...look.grade };
  KEYS.forEach((key, k) => {
    const v = g[key];
    if (Number.isNaN(v)) return; // e.g. foliage hue left untouched by the preset
    (g[key] as number) = v + SPAN[key]! * curve(k, t);
  });
  g.contrast = Math.max(-0.6, Math.min(0.6, g.contrast));
  g.blacks = Math.max(0, g.blacks);
  g.saturation = Math.max(0, g.saturation);
  const n = KEYS.length;
  g.shadowTint = [g.shadowTint[0] + 0.016 * curve(n, t), g.shadowTint[1] + 0.016 * curve(n + 1, t)];
  g.highlightTint = [g.highlightTint[0] + 0.012 * curve(n + 2, t), g.highlightTint[1] + 0.012 * curve(n + 3, t)];
  return { ...look, grade: g };
}

/** Scale factor (around 1) for shader effects such as fringes and flares. */
export const tweakEffect = (t: number, channel: number) => 1 + 0.3 * curve(40 + channel, t);
