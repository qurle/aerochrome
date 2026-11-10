// Look definitions. A look is a pure colour → colour function, so it can be
// baked into a 3D LUT. Hue numbers are OKLCh degrees, measured on iPhone
// photos: foliage sits around 95–150°, skin 30–60°, blue sky 225–245°.

import {
  type LCh, type Space, type Vec3,
  clamp01, hueBand, hueDelta, labToLch, lchToLab, lchToLinearInGamut, mix, oklabRamp, smoothstep,
} from './spaces';

export type { LCh } from './spaces';

export interface Grade {
  /** Target hue for vegetation (NaN keeps the original hue) and how much of the original spread to keep. */
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
  /**
   * Variant used where the scene mask (Detect foliage) has a say: `foliage` for
   * vegetation and forested terrain, `object` for things that are never plants.
   */
  mode?: LookMode;
}

export type LookMode = 'foliage' | 'object';

const NEUTRAL: Grade = {
  foliageHue: NaN, foliageSpread: 0.3, foliageChroma: 1, foliageChromaMin: 0, foliageLift: 0,
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
// The band reaches into teal (~170°) for hazy, distant forest; cyan starts above it.
export function foliageWeight(c: LCh) {
  return hueBand(c.h, 100, 165, 22) * smoothstep(0.012, 0.045, c.C) * smoothstep(0.04, 0.14, c.L);
}
const skyWeight = (c: LCh) => hueBand(c.h, 222, 268, 18) * smoothstep(0.01, 0.04, c.C);
const cyanWeight = (c: LCh) => hueBand(c.h, 190, 218, 10) * smoothstep(0.015, 0.05, c.C);
/**
 * How much of the sky darkening applies. Bright, faintly blue pixels (cloud edges)
 * ease in over a wide chroma range; otherwise a small chroma change across a cloud
 * flips it from untouched to fully darkened, which draws hard edges.
 */
const skyDepthWeight = (c: LCh) =>
  mix(1, smoothstep(0.02, 0.12, c.C), smoothstep(0.6, 0.8, c.L));
/**
 * Vegetation weight where the scene mask says "plants": any hue a leaf can take
 * in a photo, hazy blue-grey included, except skin-warm tones, saturated sky
 * seen through the canopy and near-greys (rock, snow, cloud).
 */
function maskedFoliageWeight(c: LCh) {
  const sky = hueBand(c.h, 225, 275, 12) * smoothstep(0.075, 0.11, c.C);
  const plant = hueBand(c.h, 85, 245, 14) * (1 - sky) * smoothstep(0.012, 0.035, c.C) * smoothstep(0.04, 0.14, c.L);
  return Math.max(foliageWeight(c), plant);
}
/** Distant foliage reads blue-grey through haze. */
const hazeWeight = (c: LCh) => hueBand(c.h, 182, 250, 14) * (1 - smoothstep(0.07, 0.11, c.C));
/** Closest hue inside [lo, hi] (degrees, lo < hi). */
const clampHue = (h: number, lo: number, hi: number) =>
  h >= lo && h <= hi ? h : Math.abs(hueDelta(h, lo)) < Math.abs(hueDelta(h, hi)) ? lo : hi;

const skinWeight = (c: LCh) => hueBand(c.h, 28, 68, 14) * smoothstep(0.02, 0.05, c.C) * (1 - smoothstep(0.16, 0.22, c.C));

function applyGrade(space: Space, lin: Vec3, g: Grade, mode?: LookMode): LCh {
  const c = labToLch(space.toOklab(lin));
  let { L, C, h } = c;

  const byColour = foliageWeight(c);
  const wf = mode === 'foliage' ? maskedFoliageWeight(c) : mode === 'object' ? 0 : byColour;
  const ws = skyWeight(c) * (1 - wf);
  const wc = cyanWeight(c) * (1 - wf);
  const wk = skinWeight(c);
  const wo = Math.max(0, 1 - wf - ws - wc);
  const infrared = !Number.isNaN(g.foliageHue);

  // Vegetation: rotate towards the target hue, keep some of the original spread.
  if (wf > 0) {
    // Masked foliage of any hue is placed as if it were the nearest leaf green.
    const leaf = mode === 'foliage' ? clampHue(h, 95, 165) : h;
    const target = infrared ? g.foliageHue + hueDelta(125, leaf) * g.foliageSpread : leaf;
    h = h + hueDelta(h, target) * wf;
    C = mix(C, Math.max(C * g.foliageChroma, g.foliageChromaMin), wf);
    L = L + g.foliageLift * wf * (1 - L) * smoothstep(0.08, 0.4, c.L);
    // Aerial perspective: hazy, distant foliage drifts towards the sky's colour
    // and loses some saturation (on Aerochrome, red towards deep blue: magenta).
    const haze = mode === 'foliage' ? hazeWeight(c) * wf : 0;
    if (haze > 0) {
      h = h + hueDelta(h, g.skyHue) * haze * 0.35;
      C *= 1 - 0.4 * haze;
    }
  }
  // Greens that aren't plants (paint, plastic, fabric) reflect little infrared:
  // on film they go blue rather than red.
  if (mode === 'object' && infrared && byColour > 0) {
    h = h + hueDelta(h, g.skyHue) * byColour * 0.55;
    C *= 1 - 0.25 * byColour;
  }
  if (ws > 0) {
    h = h + hueDelta(h, g.skyHue) * ws * g.skyHueAmount;
    C = mix(C, C * g.skyChroma, ws);
    L = L * (1 - g.skyDepth * ws * skyDepthWeight(c) * 0.45);
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

function applyMap(c: LCh, m: GradientMap, cache: Map<GradientMap, (t: number) => Vec3>): LCh {
  let ramp = cache.get(m);
  if (!ramp) cache.set(m, (ramp = oklabRamp(m.stops)));
  const target = ramp(c.L);
  const cur = lchToLab(c);
  return labToLch([mix(cur[0], target[0], m.amount), mix(cur[1], target[1], m.amount), mix(cur[2], target[2], m.amount)]);
}

/**
 * Approximate the film's false-colour shift on a visible-light photo:
 * NIR → R, R → G, G → B. NIR is guessed per colour, since phones don't record it.
 */
function applyFilm(space: Space, lin: Vec3, f: FilmShift, mode?: LookMode): Vec3 {
  const [r, g, b] = lin;
  const c = labToLch(space.toOklab(lin));
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Non-plant greens get no infrared kick, so the channel shift turns them blue.
  const veg = mode === 'foliage' ? maskedFoliageWeight(c) : mode === 'object' ? 0 : foliageWeight(c);
  const blue = skyWeight(c) + cyanWeight(c) * 0.5;
  const warm = Math.max(0, r - g);
  let nir = Math.max(Y, r) + f.warmNir * warm;
  nir = nir * (1 - f.blueAbsorb * blue);
  nir = mix(nir, Math.min(1, Math.max(nir, g * f.vegNir)), veg);
  return [clamp01(nir), clamp01(r), clamp01(g)];
}

const mapCache = new Map<GradientMap, (t: number) => Vec3>();

export function evalLook(space: Space, look: Look, lin: Vec3): Vec3 {
  // With a film shift the mask acts on the infrared guess; the grade after it
  // sees false colours, so it runs as usual.
  const shifted = look.film ? applyFilm(space, lin, look.film, look.mode) : lin;
  let out = applyGrade(space, shifted, look.grade, look.film ? undefined : look.mode);
  if (look.map) out = applyMap(out, look.map, mapCache);
  if (look.custom) out = look.custom(out, labToLch(space.toOklab(lin)));
  return lchToLinearInGamut(space, out);
}
