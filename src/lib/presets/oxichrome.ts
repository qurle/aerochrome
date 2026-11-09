import { grade } from '../color/looks';
import { filmDefault, type Group } from './types';

export const oxichrome: Group = {
  id: 'oxichrome',
  name: 'Oxichrome',
  presets: [
    {
      id: 'oxi-classic',
      name: 'Classic',
      film: filmDefault,
      look: {
        grade: grade({
          foliageHue: 55, foliageSpread: 0.25, foliageChroma: 1.6, foliageChromaMin: 0.1, foliageLift: 0.08,
          skyHue: 242, skyHueAmount: 0.3, skyDepth: 0.2, skyChroma: 0.9,
          skinPale: 0.15, otherChroma: 0.6, tintB: 0.006, contrast: 0.06, blacks: 0.03,
        }),
      },
    },
    {
      id: 'oxi-amber',
      name: 'Amber',
      film: filmDefault,
      look: {
        grade: grade({
          foliageHue: 72, foliageSpread: 0.2, foliageChroma: 1.7, foliageChromaMin: 0.12, foliageLift: 0.15,
          skyHue: 222, skyHueAmount: 0.6, skyDepth: 0.25, skyChroma: 1.1,
          cyanHue: 200, cyanAmount: 0.4,
          skinPale: 0.1, otherChroma: 0.7, tintB: 0.008, contrast: 0.1,
        }),
      },
    },
    {
      id: 'oxi-rust',
      name: 'Rust',
      film: { ...filmDefault, vignette: 1.4 },
      look: {
        grade: grade({
          foliageHue: 40, foliageSpread: 0.2, foliageChroma: 1.45, foliageChromaMin: 0.1, foliageLift: 0,
          skyHue: 250, skyHueAmount: 0.4, skyDepth: 0.45, skyChroma: 1.1,
          skinPale: 0.1, otherChroma: 0.75, tintA: 0.006, tintB: 0.01, contrast: 0.26,
        }),
      },
    },
    {
      id: 'oxi-bleach',
      name: 'Bleach',
      film: { ...filmDefault, fade: 1.5, soft: 1.2 },
      look: {
        grade: grade({
          foliageHue: 58, foliageSpread: 0.25, foliageChroma: 1.3, foliageChromaMin: 0.09, foliageLift: 0.12,
          skyChroma: 0.6, skinPale: 0.35, otherChroma: 0.35,
          contrast: -0.08, blacks: 0.06, whites: 0.97,
        }),
      },
    },
  ],
};
