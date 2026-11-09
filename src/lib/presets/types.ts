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
  /** Rainbow dispersion towards the edges, like light through a prism (try 0.05–0.3). */
  prism?: number;
  /** Iridescent rainbow rings around highlights plus mirrored lens ghosts (0..1). */
  flare?: number;
  /** Scattered prism light spots: [amount 0..1, count up to 12, size as a fraction of the frame ~0.05–0.2]. Layout is random per photo. */
  leak?: [number, number, number];
  /** Rainbow tint on contrast edges, hue following edge direction (0..1). */
  edge?: number;
}

export interface Group {
  id: string;
  name: string;
  presets: Preset[];
}

export const filmDefault: FilmRecipe = { grain: 1, halation: 1, vignette: 1, soft: 1, fade: 1 };
