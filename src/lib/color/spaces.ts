// Colour-space helpers. All maths runs on plain numbers so LUTs can be
// baked on the CPU once per preset and sampled on the GPU.

export type WorkingSpace = 'display-p3' | 'srgb';
export type Vec3 = [number, number, number];

// Both sRGB and Display P3 share the sRGB transfer curve.
export const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
export const toEncoded = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;

const mul = (m: number[], v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

const P3_TO_SRGB = [
  1.2249401, -0.2249404, 0.0,
  -0.0420569, 1.0420571, 0.0,
  -0.0196376, -0.0786361, 1.0982735,
];
const SRGB_TO_P3 = [
  0.8224621, 0.177538, 0.0,
  0.0331941, 0.9668058, 0.0,
  0.0170827, 0.0723974, 0.9105199,
];

// Björn Ottosson's OKLab (from linear sRGB).
export function linSrgbToOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLinSrgb([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export interface Space {
  toOklab(lin: Vec3): Vec3;
  fromOklab(lab: Vec3): Vec3;
}

export function makeSpace(ws: WorkingSpace): Space {
  if (ws === 'srgb') return { toOklab: linSrgbToOklab, fromOklab: oklabToLinSrgb };
  return {
    toOklab: (v) => linSrgbToOklab(mul(P3_TO_SRGB, v)),
    fromOklab: (v) => mul(SRGB_TO_P3, oklabToLinSrgb(v)),
  };
}

export interface LCh { L: number; C: number; h: number }

export const labToLch = ([L, a, b]: Vec3): LCh => {
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C: Math.hypot(a, b), h };
};
export const lchToLab = ({ L, C, h }: LCh): Vec3 => {
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
};

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Signed shortest angular distance from a to b, in degrees. */
export const hueDelta = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** Soft band on the hue circle: 1 inside [lo, hi], fading over `soft` degrees. */
export function hueBand(h: number, lo: number, hi: number, soft: number) {
  const center = lo + hueDelta(lo, hi) / 2;
  const half = Math.abs(hueDelta(lo, hi)) / 2;
  const d = Math.abs(hueDelta(center, h));
  return 1 - smoothstep(half, half + soft, d);
}

/** Map an LCh colour into the working gamut by reducing chroma (keeps L and hue). */
export function lchToLinearInGamut(space: Space, lch: LCh): Vec3 {
  const inside = (v: Vec3) => v.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
  let rgb = space.fromOklab(lchToLab(lch));
  if (inside(rgb)) return rgb;
  let lo = 0, hi = lch.C;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (inside(space.fromOklab(lchToLab({ ...lch, C: mid })))) lo = mid;
    else hi = mid;
  }
  rgb = space.fromOklab(lchToLab({ ...lch, C: lo }));
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}
