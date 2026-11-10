// "Tweak": a 0–100 variation dial. 50 is the preset exactly as designed; every
// other value is a reproducible variation.
//
// To keep scrubbing instant (and free of GPU texture churn), a variation is a
// blend of pre-baked LUTs rather than a fresh bake. Each preset gets its base
// LUT plus a "+" and "−" LUT for four directions (hue, sky & temperature,
// intensity, tone). A Tweak value maps to four weights in -1..1 that follow
// smooth noise curves, so neighbouring values look alike and far-apart values
// differ; the shader mixes base + Σ |w|·(variant − base).

import type { Grade, Look } from './looks';

/** The value at which a look is left exactly as designed. */
export const TWEAK_NEUTRAL = 50;
export const TWEAK_DIRECTIONS = 4;
/** LUT slices per set: base, then +/− for each direction. */
export const SET_SLICES = 1 + TWEAK_DIRECTIONS * 2;

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/** Smooth 1D value noise for channel `k`, zero at the neutral value, within -1..1. */
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

/** Blend weights for the four directions. */
export const tweakWeights = (t: number): [number, number, number, number] =>
  [curve(0, t), curve(1, t), curve(2, t), curve(3, t)];

/** Scale factor (around 1) for shader effects such as fringes and flares. */
export const tweakEffect = (t: number, channel: number) => 1 + 0.3 * curve(40 + channel, t);

type Push = (g: Grade, s: number) => void;
const add = (g: Grade, key: keyof Grade, v: number) => {
  const cur = g[key] as number;
  if (!Number.isNaN(cur)) (g[key] as number) = cur + v; // NaN = "leave foliage hue alone"
};

/** The four directions, each applied with strength s in -1..1. */
const DIRECTIONS: Push[] = [
  // Hue: foliage and water colours rotate, with a touch of global shift.
  (g, s) => { add(g, 'foliageHue', 22 * s); add(g, 'cyanHue', 20 * s); add(g, 'skyHue', -10 * s); add(g, 'hueShift', 5 * s); },
  // Sky & temperature: sky hue and depth, warm/cool neutrals and highlights.
  (g, s) => {
    add(g, 'skyHue', 18 * s); add(g, 'skyDepth', 0.22 * s);
    add(g, 'tintA', 0.012 * s); add(g, 'tintB', -0.012 * s);
    g.highlightTint = [g.highlightTint[0] + 0.012 * s, g.highlightTint[1] + 0.004 * s];
  },
  // Intensity: how far colours are pushed.
  (g, s) => {
    add(g, 'foliageChroma', 0.28 * s); add(g, 'skyChroma', 0.22 * s);
    add(g, 'otherChroma', 0.15 * s); add(g, 'saturation', 0.12 * s); add(g, 'foliageLift', -0.06 * s);
  },
  // Tone: contrast, black level and cool shadows.
  (g, s) => {
    add(g, 'contrast', 0.15 * s); add(g, 'blacks', -0.03 * s); add(g, 'foliageLift', 0.05 * s); add(g, 'tintB', 0.01 * s);
    g.shadowTint = [g.shadowTint[0] - 0.016 * s, g.shadowTint[1] - 0.012 * s];
  },
];

function clampGrade(g: Grade) {
  g.contrast = Math.max(-0.6, Math.min(0.6, g.contrast));
  g.blacks = Math.max(0, g.blacks);
  g.saturation = Math.max(0, g.saturation);
  g.foliageChroma = Math.max(0, g.foliageChroma);
  g.skyChroma = Math.max(0, g.skyChroma);
  g.otherChroma = Math.max(0, g.otherChroma);
}

/** The look pushed fully along one direction (sign ±1): one slice of a LUT set. */
export function pushLook(look: Look, direction: number, sign: 1 | -1): Look {
  const g: Grade = { ...look.grade, shadowTint: [...look.grade.shadowTint], highlightTint: [...look.grade.highlightTint] };
  DIRECTIONS[direction](g, sign);
  clampGrade(g);
  return { ...look, grade: g };
}

/** Looks for every slice of a set, in shader order: base, d0+, d0−, d1+, d1−, … */
export function setLooks(look: Look): Look[] {
  const cached = setCache.get(look);
  if (cached) return cached;
  const out = [look];
  for (let d = 0; d < TWEAK_DIRECTIONS; d++) out.push(pushLook(look, d, 1), pushLook(look, d, -1));
  setCache.set(look, out);
  return out;
}
const setCache = new WeakMap<Look, Look[]>();

/** Variants per masked set: as designed, masked foliage, masked objects (see LookMode). */
export const MASK_GROUPS = 3;

/**
 * Looks for a masked set: three full Tweak sets in a row (normal, foliage,
 * object), so the shader can blend them per pixel by the scene mask.
 */
export function maskedSetLooks(look: Look): Look[] {
  const cached = maskedCache.get(look);
  if (cached) return cached;
  const out = [look, { ...look, mode: 'foliage' as const }, { ...look, mode: 'object' as const }].flatMap(setLooks);
  maskedCache.set(look, out);
  return out;
}
const maskedCache = new WeakMap<Look, Look[]>();

/** Exact (non-blended) variation, for checking blend accuracy in development. */
export function tweakLookExact(look: Look, t: number): Look {
  const g: Grade = { ...look.grade, shadowTint: [...look.grade.shadowTint], highlightTint: [...look.grade.highlightTint] };
  tweakWeights(t).forEach((w, d) => DIRECTIONS[d](g, w));
  clampGrade(g);
  return { ...look, grade: g };
}
