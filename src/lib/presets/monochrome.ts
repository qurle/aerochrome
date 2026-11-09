// Black-and-white looks. Each one is a channel mixer in linear RGB, the way a
// coloured filter over panchromatic film works: grey = wr·R + wg·G + wb·B with
// weights summing to 1, so neutrals keep their tone. A linear mix stays smooth
// on noisy phone JPEGs, where hue-keyed lightness shifts turn chroma noise into
// blocky skies. Infrared adds a foliage "Wood effect" on top. Then a tone curve
// and an optional print tone.

import { foliageWeight, grade, type LCh } from '../color/looks';
import { clamp01, hueBand, labToLch, lchToLab, mix, smoothstep } from '../color/spaces';
import { filmDefault, type Group } from './types';

// OKLab → linear sRGB (same maths as color/spaces, which keeps it private).
function linRgb(c: LCh): [number, number, number] {
  const [L, a, b] = lchToLab(c);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Channel mix → OKLab lightness of the resulting grey. */
function mixL(src: LCh, [wr, wg, wb]: [number, number, number]) {
  const [r, g, b] = linRgb(src);
  return Math.cbrt(Math.max(0, wr * r + wg * g + wb * b));
}

/** Contrast S-curve with a pivot; k in -1..1. */
function curve(x: number, k: number, pivot = 0.5) {
  const s = x - pivot;
  return clamp01(pivot + s * (1 + k) - 4 * k * s * s * s);
}

/** Neutral or toned output: tints are OKLab a/b in shadows, mids and highlights. */
function tone(L: number, sh: [number, number] = [0, 0], hi: [number, number] = [0, 0], mid: [number, number] = [0, 0]): LCh {
  const ws = 1 - smoothstep(0.05, 0.6, L);
  const wh = smoothstep(0.4, 0.98, L);
  const wm = Math.max(0, 1 - ws - wh) * Math.sin(Math.PI * clamp01(L));
  // Fade the tint out at pure black and white so the ends stay clean.
  const ends = smoothstep(0, 0.08, L) * (1 - smoothstep(0.96, 1, L) * 0.7);
  const a = (sh[0] * ws + hi[0] * wh + mid[0] * wm) * ends;
  const b = (sh[1] * ws + hi[1] * wh + mid[1] * wm) * ends;
  return labToLch([L, a, b]);
}

const skinWeight = (c: LCh) =>
  hueBand(c.h, 25, 70, 16) * smoothstep(0.015, 0.06, c.C) * (1 - smoothstep(0.17, 0.25, c.C)) * smoothstep(0.2, 0.45, c.L);

/** Pull skin towards an even, lighter version of its own lightness (no blotches). */
const evenSkin = (L: number, src: LCh, lift: number, amount: number) =>
  mix(L, src.L + lift * (1 - src.L), skinWeight(src) * amount);

// --- Infrared (Wood effect) ------------------------------------------------
// Chlorophyll reflects near-infrared, so foliage glows; blue sky and water hold
// almost none, so they go near-black and clouds jump out. Skin glows softly.
function infrared(_out: LCh, src: LCh): LCh {
  let L = mixL(src, [1.6, 0.3, -0.9]);
  const wf = foliageWeight(src);
  L = mix(L, 0.88 + 0.1 * src.L, wf * 0.9 * smoothstep(0.03, 0.28, src.L));
  L = evenSkin(L, src, 0.16, 0.6);
  L = curve(L, 0.22, 0.4);
  return tone(0.012 + L * 0.98);
}

// --- Panchromatic film ------------------------------------------------------
// Close to a plain luminance conversion with a little extra red sensitivity,
// gentle contrast, soft toe and a hint of warm-neutral silver.
function panchro(_out: LCh, src: LCh): LCh {
  let L = mixL(src, [0.3, 0.62, 0.08]);
  L = evenSkin(L, src, 0.04, 0.3);
  L = curve(L, 0.1, 0.5);
  return tone(0.035 + L * 0.95, [0.001, 0.002], [0.002, 0.005]);
}

// --- Red filter --------------------------------------------------------------
// A deep red (#25) filter: skies go dark, foliage darkens, reds and skin go
// bright and smooth. Punchy contrast with deep blacks.
function redFilter(_out: LCh, src: LCh): LCh {
  let L = mixL(src, [1.35, 0.05, -0.4]);
  L = evenSkin(L, src, 0.1, 0.45);
  L = curve(L, 0.45, 0.46);
  return tone(L);
}

// --- Sepia print -------------------------------------------------------------
// Warm-toned fibre print: brown shadows, cream highlights, lifted blacks, soft.
function sepia(_out: LCh, src: LCh): LCh {
  let L = mixL(src, [0.32, 0.6, 0.08]);
  L = evenSkin(L, src, 0.05, 0.3);
  L = curve(L, 0.06, 0.5);
  return tone(0.08 + L * 0.86, [0.022, 0.03], [0.008, 0.03], [0.022, 0.045]);
}

const mono = grade({ saturation: 0 });

export const monochrome: Group = {
  id: 'monochrome',
  name: 'Monochrome',
  presets: [
    {
      id: 'mono-ir',
      name: 'Infrared',
      film: { ...filmDefault, grain: 1.4, halation: 1.5, soft: 1.3 },
      look: { grade: mono, custom: infrared },
    },
    {
      id: 'mono-pan',
      name: 'Silver',
      film: { ...filmDefault, grain: 1.3, halation: 0.4, fade: 0.8 },
      look: { grade: mono, custom: panchro },
    },
    {
      id: 'mono-red',
      name: 'Red',
      film: { ...filmDefault, grain: 1.5, halation: 0.3, vignette: 1.3, soft: 0.6, fade: 0.4 },
      look: { grade: mono, custom: redFilter },
    },
    {
      id: 'mono-sepia',
      name: 'Sepia',
      film: { ...filmDefault, grain: 1.1, halation: 0.6, soft: 1.2, fade: 1.3 },
      look: { grade: mono, custom: sepia },
    },
  ],
};
