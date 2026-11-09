import { grade, type LCh } from '../color/looks';
import { hueBand, hueDelta, labToLch, lchToLab, mix, smoothstep } from '../color/spaces';
import { filmDefault, type Group } from './types';

// Blue-infrared look (blue / super-blue filter + channel swap): foliage goes
// icy blue, blue sky flips warm. The grade turns the foliage; the sky flip is
// done in `custom`, blending towards the warm colour in OKLab rather than
// rotating hue, so partially-weighted sky edges fade through soft neutrals
// instead of passing through green or purple.

interface SkyFlip {
  hue: number;       // warm target hue for mid sky blue (~235°)
  spread: number;    // mirrored hue spread: cyan-ish sky goes yellower, violet-ish more orange
  chroma: number;    // chroma multiplier for the flipped sky
  chromaMin: number; // chroma floor (scaled by source chroma)
  lift: number;      // lightness lift of the flipped sky
}

const skyFlip = (s: SkyFlip) => (out: LCh, src: LCh): LCh => {
  const w = hueBand(src.h, 196, 268, 18) * smoothstep(0.006, 0.03, src.C);
  if (w <= 0) return out;
  const th = s.hue - hueDelta(235, src.h) * s.spread;
  const tC = Math.max(out.C * s.chroma, s.chromaMin * smoothstep(0.01, 0.07, src.C));
  const [, a0, b0] = lchToLab(out);
  const [, a1, b1] = lchToLab({ L: 0, C: tC, h: th });
  const L = out.L + s.lift * w * (1 - out.L);
  return labToLch([L, mix(a0, a1, w), mix(b0, b1, w)]);
};

export const sugarBlue: Group = {
  id: 'sugar-blue',
  name: 'Sugar Blue',
  presets: [
    {
      id: 'sugar-ice',
      name: 'Ice',
      film: filmDefault,
      look: {
        grade: grade({
          foliageHue: 220, foliageSpread: 0.2, foliageChroma: 1.3, foliageChromaMin: 0.09, foliageLift: 0.25,
          cyanHue: 205, cyanAmount: 0.3,
          skinPale: 0.15, otherChroma: 0.95, tintA: -0.002, tintB: -0.004, contrast: 0.08,
        }),
        custom: skyFlip({ hue: 80, spread: 0.6, chroma: 1.5, chromaMin: 0.1, lift: 0.25 }),
      },
    },
    {
      id: 'sugar-candy',
      name: 'Candy',
      film: { ...filmDefault, halation: 1.3, soft: 1.3 },
      look: {
        grade: grade({
          foliageHue: 252, foliageSpread: 0.2, foliageChroma: 1.1, foliageChromaMin: 0.1, foliageLift: 0.36,
          cyanHue: 225, cyanAmount: 0.3,
          skinPale: 0.15, otherChroma: 0.8, tintA: 0.018, tintB: -0.001,
          contrast: -0.2, blacks: 0.07, whites: 0.99,
          shadowTint: [0.012, -0.012], highlightTint: [0.012, 0.006],
        }),
        custom: skyFlip({ hue: 20, spread: 0.6, chroma: 1.4, chromaMin: 0.1, lift: 0.22 }),
      },
    },
    {
      id: 'sugar-cobalt',
      name: 'Cobalt',
      film: { ...filmDefault, vignette: 1.3 },
      look: {
        grade: grade({
          foliageHue: 258, foliageSpread: 0.15, foliageChroma: 2.0, foliageChromaMin: 0.15, foliageLift: -0.05,
          cyanHue: 235, cyanAmount: 0.4,
          skinPale: 0.1, otherChroma: 1, contrast: 0.2,
        }),
        custom: skyFlip({ hue: 55, spread: 0.6, chroma: 2.1, chromaMin: 0.15, lift: 0.08 }),
      },
    },
    {
      id: 'sugar-frost',
      name: 'Frost',
      film: { ...filmDefault, fade: 1.3, soft: 1.2 },
      look: {
        grade: grade({
          foliageHue: 235, foliageSpread: 0.15, foliageChroma: 0.45, foliageChromaMin: 0.05, foliageLift: 0.65,
          cyanHue: 225, cyanAmount: 0.3,
          skinPale: 0.3, otherChroma: 0.65, tintA: -0.003, tintB: -0.008,
          contrast: -0.08, blacks: 0.05, highlightTint: [-0.002, -0.006],
        }),
        custom: skyFlip({ hue: 72, spread: 0.5, chroma: 0.9, chromaMin: 0.055, lift: 0.35 }),
      },
    },
  ],
};
