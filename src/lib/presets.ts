import { grade, type Look } from './color/looks';

/** How the single "Filmness" slider is spent for a preset (each 0..1+). */
export interface FilmRecipe {
  grain: number;
  halation: number;
  vignette: number;
  soft: number;
  fade: number;
}

export interface Preset {
  id: string;
  name: string;
  look: Look;
  film: FilmRecipe;
  /** Lateral colour split that grows towards the frame edges (Trichrome). */
  aberration?: number;
}

export interface Group {
  id: string;
  name: string;
  presets: Preset[];
  soon?: boolean;
}

const filmDefault: FilmRecipe = { grain: 1, halation: 1, vignette: 1, soft: 1, fade: 1 };

export const GROUPS: Group[] = [
  {
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
  },
  {
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
  },
  ...['Ultraviolet', 'Trichrome', 'Monochrome', 'Sugar Blue', 'Golden Hour'].map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    presets: [],
    soon: true,
  })),
];

export const ALL_PRESETS = GROUPS.flatMap((g) => g.presets);
export const findPreset = (id: string) => ALL_PRESETS.find((p) => p.id === id) ?? ALL_PRESETS[0];
