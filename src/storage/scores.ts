// Scores and preferences live in this browser's localStorage, so every device
// keeps its own leaderboard (top 10) for each mode. `ScoreStore` is the seam: a
// shared leaderboard (a Vercel Function backed by a free hosted database) could
// implement the same interface later without the game or HUD changing.

import { isModeId, type ModeId } from '../game/modes';
import { read, write } from './local';

export interface ScoreEntry {
  name: string;
  score: number;
  /** Level (or wave, in Endless) the run reached. */
  level: number;
  date: number;
}

export interface ScoreStore {
  top(mode: ModeId): ScoreEntry[];
  best(mode: ModeId): number;
  /** Would this score make the mode's leaderboard? */
  qualifies(mode: ModeId, score: number): boolean;
  /** Adds a score; returns its 0-based position on the leaderboard, or -1 if it did not make it. */
  add(mode: ModeId, entry: ScoreEntry): number;
  clear(mode: ModeId): void;
}

const MAX_ENTRIES = 10;
const SCORES_KEY = 'bubbleshooter.scores.v2';
const LEGACY_SCORES_KEY = 'bubbleshooter.scores.v1'; // single list from before there were modes
const PREFS_KEY = 'bubbleshooter.prefs.v1';

type Table = Partial<Record<ModeId, ScoreEntry[]>>;

const valid = (e: unknown): e is ScoreEntry => !!e && typeof (e as ScoreEntry).score === 'number';

export class LocalScoreStore implements ScoreStore {
  private table(): Table {
    const t = read<Table | null>(SCORES_KEY, null);
    if (t && typeof t === 'object') return t;
    // First run after modes were added: the old single list was the endless-style game, so keep it there.
    const legacy = read<unknown>(LEGACY_SCORES_KEY, []);
    return Array.isArray(legacy) ? { endless: legacy.filter(valid) } : {};
  }

  top(mode: ModeId): ScoreEntry[] {
    const list = this.table()[mode];
    return Array.isArray(list) ? list.filter(valid) : [];
  }

  best(mode: ModeId): number {
    return this.top(mode)[0]?.score ?? 0;
  }

  qualifies(mode: ModeId, score: number): boolean {
    if (score <= 0) return false;
    const list = this.top(mode);
    return list.length < MAX_ENTRIES || score > list[list.length - 1].score;
  }

  add(mode: ModeId, entry: ScoreEntry): number {
    const table = this.table();
    const list = this.top(mode);
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.date - b.date);
    const kept = list.slice(0, MAX_ENTRIES);
    write(SCORES_KEY, { ...table, [mode]: kept });
    return kept.indexOf(entry);
  }

  clear(mode: ModeId) {
    write(SCORES_KEY, { ...this.table(), [mode]: [] });
  }
}

export interface Prefs {
  musicOn: boolean;
  music: number;
  sfxOn: boolean;
  sfx: number;
  name: string;
  seenHelp: boolean;
  lastMode: ModeId;
}

const DEFAULT_PREFS: Prefs = {
  musicOn: true,
  music: 0.6,
  sfxOn: true,
  sfx: 1,
  name: '',
  seenHelp: false,
  lastMode: 'endless',
};

const vol = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback);

export function loadPrefs(): Prefs {
  const raw = read<Partial<Prefs>>(PREFS_KEY, {});
  return {
    musicOn: raw.musicOn !== false,
    music: vol(raw.music, DEFAULT_PREFS.music),
    sfxOn: raw.sfxOn !== false,
    sfx: vol(raw.sfx, DEFAULT_PREFS.sfx),
    name: typeof raw.name === 'string' ? raw.name : '',
    seenHelp: raw.seenHelp === true,
    lastMode: isModeId(raw.lastMode) ? raw.lastMode : DEFAULT_PREFS.lastMode,
  };
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  write(PREFS_KEY, next);
  return next;
}
