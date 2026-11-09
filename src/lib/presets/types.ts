import type { Look } from '../color/looks';

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
  /** Radial colour split that grows towards the frame edges, like lens aberration (try 0.02–0.2). */
  aberration?: number;
  /** Linear R/B split as a fraction of image size, e.g. [0.004, 0] (B moves the opposite way). */
  split?: [number, number];
}

export interface Group {
  id: string;
  name: string;
  presets: Preset[];
}

export const filmDefault: FilmRecipe = { grain: 1, halation: 1, vignette: 1, soft: 1, fade: 1 };
