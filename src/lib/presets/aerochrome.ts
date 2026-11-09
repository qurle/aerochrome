import { grade } from '../color/looks';
import { filmDefault, type Group } from './types';

export const aerochrome: Group = {
  id: 'aerochrome',
  name: 'Aerochrome',
  presets: [
    {
      id: 'aero-classic',
      name: 'Classic',
      film: filmDefault,
      look: {
        grade: grade({
          foliageHue: 22, foliageSpread: 0.25, foliageChroma: 1.9, foliageChromaMin: 0.13, foliageLift: 0.04,
          skyHue: 256, skyHueAmount: 0.5, skyDepth: 0.55, skyChroma: 1.4,
          cyanHue: 225, cyanAmount: 0.5,
          skinPale: 0.2, tintA: 0.008, tintB: 0.002, contrast: 0.16,
        }),
      },
    },
    {
      id: 'aero-film',
      name: 'Film',
      film: { ...filmDefault, grain: 1.2, halation: 1.2 },
      look: {
        film: { vegNir: 3.2, blueAbsorb: 0.65, warmNir: 0.3 },
        grade: grade({ skyDepth: 0.25, skyChroma: 1.2, otherChroma: 1.05, tintA: 0.004, contrast: 0.14 }),
      },
    },
    {
      id: 'aero-magenta',
      name: 'Magenta',
      film: filmDefault,
      look: {
        grade: grade({
          foliageHue: 352, foliageSpread: 0.2, foliageChroma: 1.7, foliageChromaMin: 0.12, foliageLift: 0.1,
          skyHue: 266, skyHueAmount: 0.6, skyDepth: 0.65, skyChroma: 1.5,
          cyanHue: 240, cyanAmount: 0.6,
          skinPale: 0.25, tintA: 0.012, tintB: -0.006, contrast: 0.2,
        }),
      },
    },
    {
      id: 'aero-pastel',
      name: 'Pastel',
      film: { ...filmDefault, halation: 1.4, soft: 1.4 },
      look: {
        grade: grade({
          foliageHue: 30, foliageSpread: 0.35, foliageChroma: 1.25, foliageChromaMin: 0.09, foliageLift: 0.3,
          skyHue: 215, skyHueAmount: 0.7, skyDepth: -0.3, skyChroma: 0.8,
          cyanHue: 200, cyanAmount: 0.5,
          skinPale: 0.3, otherChroma: 0.7, tintA: 0.012, tintB: 0.012,
          contrast: -0.28, blacks: 0.09, whites: 0.98,
        }),
      },
    },
  ],
};
