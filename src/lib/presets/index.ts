import { aerochrome } from './aerochrome';
import { custom } from './custom';
import { goldenHour } from './golden-hour';
import { monochrome } from './monochrome';
import { oxichrome } from './oxichrome';
import { sugarBlue } from './sugar-blue';
import { trichrome } from './trichrome';
import type { Group } from './types';
import { ultraviolet } from './ultraviolet';

export * from './types';

export const GROUPS: Group[] = [
  aerochrome, oxichrome, ultraviolet, trichrome, monochrome, sugarBlue, goldenHour, custom,
].filter((g) => g.presets.length > 0);

export const ALL_PRESETS = GROUPS.flatMap((g) => g.presets);
export const findPreset = (id: string) => ALL_PRESETS.find((p) => p.id === id) ?? ALL_PRESETS[0];
