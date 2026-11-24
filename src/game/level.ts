import type { LevelConfig } from './config';
import { Grid, type Color } from './grid';
import { pick, type Rng } from './rng';

/**
 * Picks a colour for a new orb. Leans towards copying a neighbour so boards
 * form chunky clusters instead of pure noise (more satisfying to play).
 */
function pickColor(rng: Rng, palette: readonly Color[], left: Color | null, above: Color | null): Color {
  const roll = rng();
  if (left !== null && roll < 0.28) return left;
  if (above !== null && roll < 0.5) return above;
  return pick(rng, palette);
}

export function generateBoard(cfg: LevelConfig, rng: Rng): Grid {
  const grid = new Grid();
  const palette: Color[] = Array.from({ length: cfg.colors }, (_, i) => i);
  for (let r = 0; r < cfg.rows; r++) {
    const len = grid.rowLength(r);
    for (let c = 0; c < len; c++) {
      const left = c > 0 ? grid.get(r, c - 1) : null;
      const above = r > 0 ? grid.get(r - 1, c) : null;
      grid.set(r, c, pickColor(rng, palette, left, above));
    }
  }
  return grid;
}

/** A fresh top row for the "ceiling drops" event, using only colours still in play. */
export function generateRow(grid: Grid, rng: Rng): Color[] {
  const palette = grid.colorsPresent();
  const colors = palette.length ? palette : [0, 1, 2];
  const len = grid.nextTopRowLength();
  const row: Color[] = [];
  for (let c = 0; c < len; c++) {
    row.push(pickColor(rng, colors, c > 0 ? row[c - 1] : null, null));
  }
  return row;
}
