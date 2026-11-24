import { RANKS, type Rank } from './config';

/** Consecutive popping shots build a multiplier (x1, x1.5, x2 ... capped at x3). */
export function comboMultiplier(combo: number): number {
  return Math.min(3, 1 + 0.5 * Math.max(0, combo - 1));
}

export function popPoints(count: number, combo: number): number {
  return Math.round(count * 10 * comboMultiplier(combo));
}

/** Orbs cut loose from the ceiling are worth more than popped ones, doubling for each extra one up to a cap. */
export function dropPoints(count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += 20 * 2 ** Math.min(i, 3);
  return total;
}

export interface RankInfo {
  index: number;
  rank: Rank;
  next: Rank | null;
  progress: number; // 0..1 towards the next rank (1 at max rank)
}

export function rankFor(score: number): RankInfo {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (score >= RANKS[i].min) index = i;
  const rank = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  const progress = next ? (score - rank.min) / (next.min - rank.min) : 1;
  return { index, rank, next, progress };
}
