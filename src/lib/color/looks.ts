// Look definitions. A look is a pure colour → colour function, so it can be
// baked into a 3D LUT. Hue numbers are OKLCh degrees, measured on iPhone
// photos: foliage sits around 95–150°, skin 30–60°, blue sky 225–245°.

import {
  type LCh, type Space, type Vec3,
  clamp01, hueBand, hueDelta, labToLch, lchToLab, lchToLinearInGamut, linSrgbToOklab, mix, smoothstep, toLinear,
} from './spaces';

export type { LCh } from './spaces';

export interface Grade {
  /** Target hue for vegetation and how much of the original hue spread to keep. */
  foliageHue: number;
  foliageSpread: number;
  foliageChroma: number;     // chroma multiplier for vegetation
  foliageChromaMin: number;  // chroma floor, so dull olive leaves still colour up
  foliageLift: number;       // lightness lift (infrared "glow")
  /** Blue sky. */
  skyHue: number;
  skyHueAmount: number;
  skyDepth: number;          // 0..1 darkening of blue areas
  skyChroma: number;
  /** Cyan / teal (water, glass). */
  cyanHue: number;
  cyanAmount: number;
  /** Skin and other warm tones. */
  skinPale: number;          // 0 keeps skin, 1 = pale waxy film skin
  /** Everything that isn't vegetation or sky. */
  otherChroma: number;
  /** Tint applied to near-neutral colours, OKLab a/b. */
  tintA: number;
  tintB: number;
  /** Tone. */
  contrast: number;          // -1..1 S-curve on lightness
  blacks: number;            // black level lift (0..0.1)
  whites: number;            // white level (0.9..1)
  /** Applied last, to everything. */
  hueShift: number;          // global hue rotation, degrees
  saturation: number;        // global chroma multiplier (0 = monochrome)
  shadowTint: [number, number];    // OKLab a/b added to shadows (split toning)
  highlightTint: [number, number]; // OKLab a/b added to highlights
}

export interface FilmShift {
  /** Infrared-ness of vegetation relative to its green channel. */
  vegNir: number;
  /** How strongly blue surfaces lose infrared (sky goes deep blue). */
  blueAbsorb: number;
  /** Infrared kick for warm surfaces (skin, red paint go yellow-pale). */
  warmNir: number;
}

/** Maps output lightness onto a colour ramp (duotone, tritone, thermal…). */
export interface GradientMap {
  /** Stops sorted by `at` (0 = black point, 1 = white point); colours are sRGB hex. */
  stops: { at: number; color: string }[];
  /** 0..1 blend with the graded colour, in OKLab. */
  amount: number;
}

export interface Look {
  grade: Grade;
  /** When set, a false-colour channel shift runs before the grade. */
  film?: FilmShift;
  /** Optional ramp applied after the grade. */
  map?: GradientMap;
  /**
   * Escape hatch for anything the grade can't express. Runs last, before gamut
   * mapping. `out` is the graded colour, `src` the original; both OKLCh.
   * Must be a pure function of its inputs (it is baked into a LUT).
   */
  custom?: (out: LCh, src: LCh) => LCh;
}

const NEUTRAL: Grade = {
  foliageHue: 25, foliageSpread: 0.3, foliageChroma: 1, foliageChromaMin: 0, foliageLift: 0,
  skyHue: 250, skyHueAmount: 0, skyDepth: 0, skyChroma: 1,
  cyanHue: 210, cyanAmount: 0,
  skinPale: 0, otherChroma: 1, tintA: 0, tintB: 0,
  contrast: 0, blacks: 0, whites: 1,
  hueShift: 0, saturation: 1, shadowTint: [0, 0], highlightTint: [0, 0],
};
export const grade = (g: Partial<Grade>): Grade => ({ ...NEUTRAL, ...g });

const sCurve = (x: number, k: number) => {
  // Symmetric contrast curve around 0.5; k in -1..1.
  const s = x - 0.5;
  const curved = 0.5 + s * (1 + k) - (4 * k * s * s * s);
  return clamp01(curved);
};

/** Vegetation likelihood from colour alone (no masks). */
export function foliageWeight(c: LCh) {
  return hueBand(c.h, 100, 150, 24) * smoothstep(0.012, 0.045, c.C) * smoothstep(0.05, 0.16, c.L);
}
const skyWeight = (c: LCh) => hueBand(c.h, 222, 268, 18) * smoothstep(0.01, 0.04, c.C);
const cyanWeight = (c: LCh) => hueBand(c.h, 175, 215, 12) * smoothstep(0.015, 0.05, c.C);
const skinWeight = (c: LCh) => hueBand(c.h, 28, 68, 14) * smoothstep(0.02, 0.05, c.C) * (1 - smoothstep(0.16, 0.22, c.C));

function applyGrade(space: Space, lin: Vec3, g: Grade): LCh {
  const c = labToLch(space.toOklab(lin));
  let { L, C, h } = c;

  const wf = foliageWeight(c);
  const ws = skyWeight(c);
  const wc = cyanWeight(c);
  const wk = skinWeight(c);
  const wo = Math.max(0, 1 - wf - ws - wc);

  // Vegetation: rotate towards the target hue, keep some of the original spread.
  if (wf > 0) {
    const target = g.foliageHue + hueDelta(125, h) * g.foliageSpread;
    h = h + hueDelta(h, target) * wf;
    C = mix(C, Math.max(C * g.foliageChroma, g.foliageChromaMin), wf);
    L = L + g.foliageLift * wf * (1 - L) * smoothstep(0.08, 0.4, c.L);
  }
  if (ws > 0) {
    h = h + hueDelta(h, g.skyHue) * ws * g.skyHueAmount;
    C = mix(C, C * g.skyChroma, ws);
    L = L * (1 - g.skyDepth * ws * 0.45);
  }
  if (wc > 0) h = h + hueDelta(h, g.cyanHue) * wc * g.cyanAmount;
  if (wk > 0 && g.skinPale > 0) {
    C = C * (1 - 0.35 * g.skinPale * wk);
    L = L + 0.04 * g.skinPale * wk * (1 - L);
  }
  C = mix(C, C * g.otherChroma, wo * (1 - wk * 0.6));

  // Tint near-neutrals (more in shadows and mids than in highlights).
  const neutral = 1 - smoothstep(0.02, 0.09, C);
  const tintAmt = neutral * (1 - smoothstep(0.6, 1, L) * 0.6);
  let a = C * Math.cos((h * Math.PI) / 180) + g.tintA * tintAmt;
  let b = C * Math.sin((h * Math.PI) / 180) + g.tintB * tintAmt;
  C = Math.hypot(a, b);
  h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

  L = sCurve(L, g.contrast);
  L = g.blacks + L * (g.whites - g.blacks);

  // Global stage: hue rotation, saturation, split toning.
  h = (h + g.hueShift + 360) % 360;
  C *= g.saturation;
  const sh = (1 - smoothstep(0.1, 0.6, L)), hi = smoothstep(0.45, 0.95, L);
  a = C * Math.cos((h * Math.PI) / 180) + g.shadowTint[0] * sh + g.highlightTint[0] * hi;
  b = C * Math.sin((h * Math.PI) / 180) + g.shadowTint[1] * sh + g.highlightTint[1] * hi;
  return labToLch([L, a, b]);
}

const hexToLab = (hex: string): Vec3 => {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as Vec3;
  return linSrgbToOklab(lin);
};

function applyMap(c: LCh, m: GradientMap, cache: Map<GradientMap, { at: number; lab: Vec3 }[]>): LCh {
  let stops = cache.get(m);
  if (!stops) {
    stops = m.stops.map((s) => ({ at: s.at, lab: hexToLab(s.color) }));
    cache.set(m, stops);
  }
  const t = clamp01(c.L);
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1].at) i++;
  const s0 = stops[i], s1 = stops[Math.min(i + 1, stops.length - 1)];
  const f = s1.at > s0.at ? clamp01((t - s0.at) / (s1.at - s0.at)) : 0;
  const ramp = s0.lab.map((v, k) => mix(v, s1.lab[k], f)) as Vec3;
  const cur = lchToLab(c);
  return labToLch(cur.map((v, k) => mix(v, ramp[k], m.amount)) as Vec3);
}

/**
 * Approximate the film's false-colour shift on a visible-light photo:
 * NIR → R, R → G, G → B. NIR is guessed per colour, since phones don't record it.
 */
function applyFilm(space: Space, lin: Vec3, f: FilmShift): Vec3 {
  const [r, g, b] = lin;
  const c = labToLch(space.toOklab(lin));
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const veg = foliageWeight(c);
  const blue = skyWeight(c) + cyanWeight(c) * 0.5;
  const warm = Math.max(0, r - g);
  let nir = Math.max(Y, r) + f.warmNir * warm;
  nir = nir * (1 - f.blueAbsorb * blue);
  nir = mix(nir, Math.min(1, Math.max(nir, g * f.vegNir)), veg);
  return [clamp01(nir), clamp01(r), clamp01(g)];
}

const mapCache = new Map<GradientMap, { at: number; lab: Vec3 }[]>();

export function evalLook(space: Space, look: Look, lin: Vec3): Vec3 {
  const shifted = look.film ? applyFilm(space, lin, look.film) : lin;
  let out = applyGrade(space, shifted, look.grade);
  if (look.map) out = applyMap(out, look.map, mapCache);
  if (look.custom) out = look.custom(out, labToLch(space.toOklab(lin)));
  return lchToLinearInGamut(space, out);
}
