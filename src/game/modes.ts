import { ORB_TYPES, type LevelConfig } from './config';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'impossible';
export type ModeId = Difficulty | 'endless';

export const LEVELS_PER_MODE = 5;

export interface ModeDef {
  id: ModeId;
  name: string;
  tagline: string;
  /** How many levels there are, or null if the mode never ends. */
  levels: number | null;
  /** How many wall bounces the dotted aim guide previews. Fewer means you have to judge more yourself. */
  guideBounces: number;
  /** Which planet's colour tints this mode's card, and which planet is its icon. */
  planet: number;
  /** 'cluster' draws a pile of all six planets as the icon instead of the single planet. */
  icon: 'planet' | 'cluster';
  config(level: number): LevelConfig;
}

/** A campaign mode: five hand-tuned levels. Every list has one entry per level. */
function campaign(
  id: Difficulty,
  name: string,
  tagline: string,
  guideBounces: number,
  planet: number,
  t: { rows: number[]; colors: number[]; misses: number[] },
): ModeDef {
  return {
    id,
    name,
    tagline,
    levels: LEVELS_PER_MODE,
    guideBounces,
    planet,
    icon: 'planet',
    config(level) {
      const i = Math.min(Math.max(level, 1), LEVELS_PER_MODE) - 1;
      return { rows: t.rows[i], colors: t.colors[i], missLimit: t.misses[i] };
    },
  };
}

const easy = campaign('easy', 'Easy', 'Gentle start. Few planets, plenty of time.', 2, 2, {
  rows: [4, 4, 5, 5, 6],
  colors: [3, 4, 4, 5, 5],
  misses: [7, 7, 7, 6, 5],
});

const medium = campaign('medium', 'Medium', 'The classic game. A fair fight.', 2, 3, {
  rows: [5, 6, 6, 7, 7],
  colors: [4, 5, 5, 5, 6],
  misses: [5, 5, 5, 5, 4],
});

const hard = campaign('hard', 'Hard', 'Packed boards, all six planets, a short fuse.', 1, 1, {
  rows: [6, 7, 7, 8, 9],
  colors: [5, 5, 6, 6, 6],
  misses: [4, 4, 4, 4, 3],
});

const impossible = campaign('impossible', 'Impossible', 'Near-full boards, no bank-shot preview. Good luck.', 0, 5, {
  rows: [8, 9, 9, 10, 11],
  colors: [6, 6, 6, 6, 6],
  misses: [3, 3, 3, 3, 3],
});

/** Endless: relaxed and forgiving. Clear the board and a fresh wave glides in; it only ends if the planets reach the horizon. */
const endless: ModeDef = {
  id: 'endless',
  name: 'Endless',
  tagline: 'No levels, no end. Just keep popping.',
  levels: null,
  guideBounces: 2,
  planet: 4, // tints the card blue; the icon is a pile of every planet
  icon: 'cluster',
  config(wave) {
    const w = Math.max(1, wave);
    return {
      rows: Math.min(5 + Math.floor((w - 1) / 2), 8),
      colors: Math.min(4 + Math.floor((w - 1) / 2), ORB_TYPES),
      missLimit: w >= 14 ? 4 : w >= 6 ? 5 : 6,
    };
  },
};

export const MODES: Record<ModeId, ModeDef> = { easy, medium, hard, impossible, endless };
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'impossible'];
export const MODE_IDS: ModeId[] = [...DIFFICULTIES, 'endless'];

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && v in MODES;
}
