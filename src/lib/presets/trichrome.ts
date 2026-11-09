import { grade } from '../color/looks';
import { filmDefault, type Group } from './types';

// Fake three-exposure RGB separation: R and B are displaced (mostly radially,
// growing towards the borders) while the grade gives each a different print.
export const trichrome: Group = {
  id: 'trichrome',
  name: 'Trichrome',
  presets: [
    {
      id: 'tri-clean',
      name: 'Prism',
      film: { ...filmDefault, grain: 0.6, halation: 0.5, fade: 0.5 },
      aberration: 0.07,
      look: {
        grade: grade({
          foliageHue: 125, foliageSpread: 1, skyChroma: 1.15,
          tintA: -0.002, tintB: -0.006, contrast: 0.15, saturation: 1.15,
          highlightTint: [0, -0.006],
        }),
      },
    },
    {
      id: 'tri-vintage',
      name: 'Vintage',
      film: { ...filmDefault, grain: 1.3, halation: 1.2, fade: 1.3 },
      aberration: 0.15,
      split: [0.0015, -0.001],
      look: {
        grade: grade({
          foliageHue: 105, foliageSpread: 0.5, foliageChroma: 0.85,
          skyChroma: 0.8, otherChroma: 0.9, saturation: 0.9,
          tintA: 0.008, tintB: 0.024, contrast: 0.06, blacks: 0.07, whites: 0.95,
          shadowTint: [0.014, 0.01], highlightTint: [0.012, 0.035],
        }),
      },
    },
    {
      id: 'tri-cross',
      name: 'Cross',
      film: { ...filmDefault, grain: 1, halation: 0.8 },
      aberration: 0.08,
      split: [0.004, 0],
      look: {
        grade: grade({
          foliageHue: 165, foliageSpread: 0.5, foliageChroma: 1.2,
          skyHue: 220, skyHueAmount: 0.5, skyChroma: 1.2,
          cyanHue: 200, cyanAmount: 0.6,
          contrast: 0.22, saturation: 1.1,
          shadowTint: [-0.035, -0.028], highlightTint: [0.028, 0.014],
        }),
      },
    },
    {
      id: 'tri-extreme',
      name: 'Shatter',
      film: { ...filmDefault, grain: 1.2, vignette: 1.3 },
      aberration: 0.22,
      split: [0.002, 0.002],
      look: {
        grade: grade({
          foliageHue: 125, foliageSpread: 1, foliageChroma: 1.15,
          skyDepth: 0.35, skyChroma: 1.3,
          contrast: 0.4, saturation: 1.25, otherChroma: 1.1,
          shadowTint: [0.012, -0.02], highlightTint: [-0.004, 0.01],
        }),
      },
    },
  ],
};
