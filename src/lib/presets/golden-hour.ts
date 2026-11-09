import { grade } from '../color/looks';
import { filmDefault, type Group } from './types';

// Golden infrared (590 nm filter): vegetation goes gold/honey/champagne, skies
// stay a rich blue, the frame glows warm like late-afternoon sun. Distinct from
// Oxichrome (orange foliage, pale surroundings): foliage here is yellow-gold.
export const goldenHour: Group = {
  id: 'golden-hour',
  name: 'Golden Hour',
  presets: [
    {
      id: 'gold-classic',
      name: 'Gilded',
      film: { ...filmDefault, halation: 1.3 },
      look: {
        grade: grade({
          foliageHue: 93, foliageSpread: 0.2, foliageChroma: 1.8, foliageChromaMin: 0.13, foliageLift: 0.14,
          skyHue: 248, skyHueAmount: 0.6, skyDepth: 0.55, skyChroma: 1.5,
          cyanHue: 232, cyanAmount: 0.5,
          skinPale: 0.05, otherChroma: 0.9, tintA: 0.002, tintB: 0.006, contrast: 0.15,
          highlightTint: [0.006, 0.018],
        }),
      },
    },
    {
      id: 'gold-champagne',
      name: 'Champagne',
      film: { ...filmDefault, halation: 1.6, soft: 1.3, fade: 1.2 },
      look: {
        grade: grade({
          foliageHue: 86, foliageSpread: 0.2, foliageChroma: 1.2, foliageChromaMin: 0.09, foliageLift: 0.35,
          skyHue: 236, skyHueAmount: 0.5, skyDepth: 0.1, skyChroma: 1,
          skinPale: 0.1, otherChroma: 0.8, tintA: 0.006, tintB: 0.014,
          contrast: -0.2, blacks: 0.08, whites: 0.98,
          shadowTint: [0.008, 0.01], highlightTint: [0.01, 0.024],
        }),
      },
    },
    {
      id: 'gold-honey',
      name: 'Honey',
      film: { ...filmDefault, halation: 1.3, vignette: 1.2 },
      look: {
        grade: grade({
          foliageHue: 78, foliageSpread: 0.15, foliageChroma: 2, foliageChromaMin: 0.15, foliageLift: -0.04,
          skyHue: 216, skyHueAmount: 0.5, skyDepth: 0.45, skyChroma: 1.4,
          cyanHue: 200, cyanAmount: 0.6,
          otherChroma: 0.9, tintA: -0.012, tintB: -0.008, contrast: 0.28,
          shadowTint: [-0.045, -0.028], highlightTint: [0.014, 0.03],
        }),
      },
    },
    {
      id: 'gold-halo',
      name: 'Halo',
      film: { ...filmDefault, halation: 1.6, soft: 1.5, grain: 0.7 },
      look: {
        grade: grade({
          foliageHue: 95, foliageSpread: 0.15, foliageChroma: 1, foliageChromaMin: 0.08, foliageLift: 0.6,
          skyHue: 225, skyHueAmount: 0.5, skyDepth: -0.4, skyChroma: 0.7,
          skinPale: 0.25, otherChroma: 0.55, tintA: 0.004, tintB: 0.012,
          contrast: -0.25, blacks: 0.08, whites: 1,
          highlightTint: [0.004, 0.018],
        }),
        // High-key: open up the mids so the frame reads bright and airy.
        custom: (out) => ({ ...out, L: 1 - Math.pow(1 - out.L, 1.35) }),
      },
    },
  ],
};
