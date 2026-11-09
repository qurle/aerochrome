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
        // After the channel shift, skin lands in the foliage band; rotating it to red keeps faces warm.
        grade: grade({ foliageHue: 25, skyDepth: 0.25, skyChroma: 1.2, otherChroma: 1.05, tintA: 0.004, contrast: 0.14 }),
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
      id: 'aero-teal',
      name: 'Teal',
      film: { ...filmDefault, halation: 1.3 },
      look: {
        grade: grade({
          foliageHue: 18, foliageSpread: 0.3, foliageChroma: 1.6, foliageChromaMin: 0.13, foliageLift: 0.16,
          skyHue: 198, skyHueAmount: 0.9, skyDepth: 0.3, skyChroma: 1.6,
          cyanHue: 192, cyanAmount: 0.7,
          skinPale: 0.15, otherChroma: 0.95, tintA: -0.012, tintB: -0.006, contrast: 0.26,
          shadowTint: [-0.055, -0.02], highlightTint: [0.01, 0.018],
        }),
      },
    },
  ],
};
