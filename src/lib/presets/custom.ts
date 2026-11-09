import { grade, type LCh } from '../color/looks';
import { clamp01, hueBand, labToLch, mix, oklabRamp, smoothstep } from '../color/spaces';
import { filmDefault, type Group } from './types';

/** Colour ramp in OKLab over t in 0..1 (stops sorted by position). */
const ramp = (stops: [number, string][]) => {
  const r = oklabRamp(stops.map(([at, color]) => ({ at, color })));
  return (t: number): LCh => labToLch(r(t));
};

/** Soft posterisation into n bands; `edge` 0 = hard steps, 0.5 = no steps. */
const softSteps = (x: number, n: number, edge: number) => {
  const y = x * n;
  const i = Math.floor(y), f = y - i;
  return clamp01((i + smoothstep(0.5 - edge, 0.5 + edge, f)) / n);
};

/** 0..1 bump that keeps chroma down near black and white. */
const body = (L: number) => Math.sin(Math.PI * clamp01(L));

/**
 * TV Girl: a two-ink poster. Warm things (skin, reds, yellows) go pink, cool and
 * green things go blue; greys split by lightness (navy shadows, pink highlights).
 * Lightness is softly posterised and chroma flattened for a screen-printed feel.
 */
const BLUE = 262, PINK = 352;
const tvGirl = (out: LCh, src: LCh): LCh => {
  const warm = smoothstep(-0.1, 0.35, Math.cos(((src.h - 25) * Math.PI) / 180));
  const chromatic = smoothstep(0.02, 0.07, src.C);
  const L0 = softSteps(out.L, 5, 0.3);
  const byL = smoothstep(0.3, 0.8, L0);
  const p = smoothstep(0.2, 0.8, clamp01(mix(byL, warm * 0.85 + byL * 0.3, chromatic)));
  const L = mix(0.17, 0.98, L0);
  const C = mix(0.1, 0.19, chromatic) * (0.3 + 0.7 * body(0.08 + L * 0.9));
  return { L, C, h: BLUE + (PINK - BLUE) * p };
};

/** Thermal camera: fake heat from brightness; skin runs hot, sky, water and leaves run cold. */
const heatRamp = ramp([
  [0, '#05001a'], [0.18, '#2a0a7a'], [0.36, '#8a1a9e'], [0.54, '#e0303a'],
  [0.7, '#ff8a00'], [0.86, '#ffe14a'], [1, '#ffffff'],
]);
const thermal = (_out: LCh, src: LCh): LCh => {
  const chromatic = smoothstep(0.02, 0.06, src.C);
  const skin = hueBand(src.h, 20, 75, 18) * chromatic;
  const cold = hueBand(src.h, 190, 275, 20) * chromatic;
  const leaf = hueBand(src.h, 100, 160, 20) * chromatic;
  return heatRamp(0.12 + src.L * 0.65 + 0.32 * skin - 0.25 * cold - 0.12 * leaf);
};

/** Acid: every hue rotated a third of the wheel back, drifting with tone, at neon chroma. */
const acid = (out: LCh, src: LCh): LCh => {
  const chromatic = smoothstep(0.015, 0.06, src.C);
  const h = (src.h - 60 + 120 * (out.L - 0.5) + 720) % 360;
  const C = Math.max(out.C * 1.8, 0.2 * chromatic + 0.04) * (0.35 + 0.65 * body(out.L));
  return { L: out.L, C, h };
};

/** Night vision: phosphor-green intensifier tube, shadows lifted and highlights blooming. */
const nvRamp = ramp([[0, '#000a02'], [0.35, '#1c5e17'], [0.7, '#76d856'], [1, '#f0fff0']]);
const nightVision = (_out: LCh, src: LCh): LCh => nvRamp(smoothstep(0.04, 1, src.L) * 0.75 + 0.5 * smoothstep(0.75, 1, src.L));

export const custom: Group = {
  id: 'custom',
  name: 'Custom',
  presets: [
    {
      id: 'custom-tv-girl',
      name: 'TV Girl',
      film: { ...filmDefault, halation: 0.6, fade: 0.6 },
      look: { grade: grade({ contrast: 0.15 }), custom: tvGirl },
    },
    {
      id: 'custom-thermal',
      name: 'Thermal',
      film: { grain: 0.4, halation: 0, vignette: 0, soft: 1.2, fade: 0 },
      look: { grade: grade({}), custom: thermal },
    },
    {
      id: 'custom-acid',
      name: 'Acid',
      film: filmDefault,
      aberration: 0.1,
      look: { grade: grade({ contrast: 0.1 }), custom: acid },
    },
    {
      id: 'custom-night-vision',
      name: 'Night Vision',
      film: { grain: 2.2, halation: 1.5, vignette: 2.2, soft: 1.2, fade: 0 },
      look: { grade: grade({}), custom: nightVision },
    },
  ],
};
