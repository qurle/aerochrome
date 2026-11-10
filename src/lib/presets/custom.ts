import { grade, type LCh } from '../color/looks';
import { clamp01, mix, smoothstep } from '../color/spaces';
import { filmDefault, type Group } from './types';

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

/**
 * Pink & Teal: a smooth two-colour split. Cool things (leaves, sky, water) go teal,
 * warm things (skin, reds, yellows) go pink; greys split by lightness (teal shadows,
 * pink highlights). Lightness is kept, so it stays photographic.
 */
const TEAL = 192, ROSE = 356;
const pinkTeal = (out: LCh, src: LCh): LCh => {
  const warm = smoothstep(0.05, 0.6, Math.cos(((src.h - 22) * Math.PI) / 180));
  const chromatic = smoothstep(0.015, 0.07, src.C);
  const byL = smoothstep(0.2, 0.85, out.L);
  const p = smoothstep(0.15, 0.85, mix(byL, warm * 0.9 + byL * 0.1, chromatic));
  const C = mix(0.045, 0.05 + 0.9 * out.C, chromatic) * (0.35 + 0.65 * body(0.05 + out.L * 0.9));
  return { L: out.L, C: Math.min(C, 0.17), h: TEAL + (ROSE - TEAL) * p };
};

/** Acid: every hue rotated a third of the wheel back, drifting with tone, at neon chroma. */
const acid = (out: LCh, src: LCh): LCh => {
  const chromatic = smoothstep(0.015, 0.06, src.C);
  const h = (src.h - 60 + 120 * (out.L - 0.5) + 720) % 360;
  const C = Math.max(out.C * 1.8, 0.2 * chromatic + 0.04) * (0.35 + 0.65 * body(out.L));
  return { L: out.L, C, h };
};


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
      id: 'custom-pink-teal',
      name: 'Pink & Teal',
      film: { ...filmDefault, halation: 0.4, fade: 0.4 },
      look: { grade: grade({ contrast: 0.08, blacks: 0.03 }), custom: pinkTeal },
    },
    {
      id: 'custom-acid',
      name: 'Acid',
      film: filmDefault,
      aberration: 0.1,
      look: { grade: grade({ contrast: 0.1 }), custom: acid },
    },
    {
      id: 'custom-prism',
      name: 'Prism',
      // Light through glass: rainbow dispersion at the edges, iridescent rings around
      // highlights, lens ghosts, scattered rainbow light spots and holographic edges,
      // over an airy, lifted grade.
      film: { grain: 0.6, halation: 1.6, vignette: 0.4, soft: 1.4, fade: 1 },
      prism: 0.12,
      flare: 0.85,
      leak: [0.55, 8, 0.12],
      edge: 0.7,
      look: {
        grade: grade({
          contrast: -0.18, blacks: 0.07, whites: 0.99, saturation: 0.9,
          skyChroma: 1.15, otherChroma: 0.95,
          shadowTint: [-0.012, -0.02], highlightTint: [0.012, -0.008],
        }),
      },
    },
  ],
};
