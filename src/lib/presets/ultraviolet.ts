import { grade, type LCh } from '../color/looks';
import { hueBand, hueDelta, smoothstep } from '../color/spaces';
import { filmDefault, type Group } from './types';

/**
 * Under UV, saturated reds and oranges (paint, signs) go dull and dark. Pull
 * strongly chromatic warm colours towards a muted berry tone; skin is far less
 * chromatic, so the chroma gate leaves faces alone.
 */
const tameReds = (amount: number, hue: number, dim: number) => (out: LCh, src: LCh): LCh => {
  const w = amount * hueBand(src.h, 0, 75, 20) * smoothstep(0.13, 0.2, src.C);
  if (w <= 0) return out;
  return {
    L: out.L * (1 - dim * w),
    C: out.C * (1 - 0.55 * w),
    h: out.h + hueDelta(out.h, hue) * w,
  };
};

export const ultraviolet: Group = {
  id: 'ultraviolet',
  name: 'Ultraviolet',
  presets: [
    {
      id: 'uv-lavender',
      name: 'Lavender',
      film: { ...filmDefault, soft: 1.3, halation: 1.2 },
      look: {
        grade: grade({
          foliageHue: 318, foliageSpread: 0.15, foliageChroma: 0.5, foliageChromaMin: 0.045, foliageLift: 0.2,
          skyHue: 285, skyHueAmount: 0.7, skyDepth: -0.5, skyChroma: 0.45,
          cyanHue: 280, cyanAmount: 0.6,
          skinPale: 0.35, otherChroma: 0.6, tintA: 0.012, tintB: -0.02,
          contrast: -0.2, blacks: 0.07, whites: 0.985,
          shadowTint: [0.01, -0.016], highlightTint: [0.016, -0.018],
        }),
        custom: tameReds(0.7, 345, 0),
      },
    },
    {
      id: 'uv-violet',
      name: 'Violet',
      film: { ...filmDefault, vignette: 1.3 },
      look: {
        grade: grade({
          foliageHue: 305, foliageSpread: 0.1, foliageChroma: 0.75, foliageChromaMin: 0.06, foliageLift: -0.55,
          skyHue: 280, skyHueAmount: 0.5, skyDepth: -0.6, skyChroma: 0.3,
          cyanHue: 290, cyanAmount: 0.6,
          skinPale: 0.3, otherChroma: 0.45, tintA: 0.016, tintB: -0.03,
          contrast: 0.26,
          shadowTint: [0.024, -0.05], highlightTint: [0.014, -0.026],
        }),
        custom: tameReds(0.9, 340, 0.3),
      },
    },
    {
      id: 'uv-ghost',
      name: 'Ghost',
      film: { ...filmDefault, grain: 1.3, fade: 1.3 },
      look: {
        grade: grade({
          foliageHue: 300, foliageChroma: 0.4, foliageLift: -0.4,
          skyDepth: -0.6, skyChroma: 0.3,
          skinPale: 0.4, saturation: 0.2, contrast: 0.16,
        }),
        map: {
          stops: [
            { at: 0, color: '#120c2a' },
            { at: 0.5, color: '#6c6898' },
            { at: 1, color: '#f0f0fb' },
          ],
          amount: 0.88,
        },
      },
    },
    {
      id: 'uv-electric',
      name: 'Electric',
      film: filmDefault,
      aberration: 0.03,
      look: {
        grade: grade({
          foliageHue: 302, foliageSpread: 0.15, foliageChroma: 1.15, foliageChromaMin: 0.1, foliageLift: -0.12,
          skyHue: 208, skyHueAmount: 0.8, skyDepth: -0.3, skyChroma: 1.7,
          cyanHue: 205, cyanAmount: 0.8,
          skinPale: 0.25, otherChroma: 0.65, tintA: 0.01, tintB: -0.02,
          contrast: 0.2,
          shadowTint: [0.024, -0.04], highlightTint: [-0.02, -0.012],
        }),
        custom: tameReds(1, 322, 0.15),
      },
    },
  ],
};
