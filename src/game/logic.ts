import { HIT_DIST, LAUNCH_X, LAUNCH_Y, R, ROW_H, D, SHOT_SPEED, W } from './config';
import type { Cell, Color, Grid, Point } from './grid';

// Pure game logic: no DOM, no rendering, no randomness. Easy to unit test.

const key = (r: number, c: number) => r * 16 + c;

/** All orbs of the same colour connected to (r, c), including (r, c). */
export function findCluster(grid: Grid, r: number, c: number): Cell[] {
  const color = grid.get(r, c);
  if (color === null) return [];
  const seen = new Set<number>([key(r, c)]);
  const out: Cell[] = [{ r, c }];
  for (let i = 0; i < out.length; i++) {
    for (const n of grid.neighbors(out[i].r, out[i].c)) {
      const k = key(n.r, n.c);
      if (seen.has(k) || grid.get(n.r, n.c) !== color) continue;
      seen.add(k);
      out.push(n);
    }
  }
  return out;
}

/** Orbs that are no longer connected to the ceiling (row 0). */
export function findFloating(grid: Grid): Cell[] {
  const seen = new Set<number>();
  const queue: Cell[] = [];
  const row0 = grid.rows[0] ?? [];
  row0.forEach((v, c) => {
    if (v !== null) {
      seen.add(key(0, c));
      queue.push({ r: 0, c });
    }
  });
  for (let i = 0; i < queue.length; i++) {
    for (const n of grid.neighbors(queue[i].r, queue[i].c)) {
      const k = key(n.r, n.c);
      if (seen.has(k) || grid.get(n.r, n.c) === null) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return grid.occupied().filter((cell) => !seen.has(key(cell.r, cell.c)));
}

const hasOccupiedNeighbor = (grid: Grid, r: number, c: number) =>
  grid.neighbors(r, c).some((n) => grid.get(n.r, n.c) !== null);

/**
 * The empty cell a shot that stopped at (x, y) should snap into: the nearest
 * empty cell that touches the ceiling or another orb.
 */
export function snapToCell(grid: Grid, x: number, y: number): Cell {
  const r0 = Math.round((y - R) / ROW_H);
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let r = Math.max(0, r0 - 2); r <= r0 + 2; r++) {
    const off = grid.isOffset(r) ? R : 0;
    const c0 = Math.round((x - R - off) / D);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (!grid.inBounds(r, c) || grid.get(r, c) !== null) continue;
      if (r !== 0 && !hasOccupiedNeighbor(grid, r, c)) continue;
      const p = grid.center(r, c);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { r, c };
      }
    }
  }
  if (best) return best;
  // Fallback (should not happen): closest free cell in the top row.
  const row0Len = grid.rowLength(0);
  let bc = 0;
  let bd = Infinity;
  for (let c = 0; c < row0Len; c++) {
    if (grid.get(0, c) !== null) continue;
    const d = Math.abs(grid.center(0, c).x - x);
    if (d < bd) {
      bd = d;
      bc = c;
    }
  }
  return { r: 0, c: bc };
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: Color;
  bounces: number;
}

export function makeShot(angle: number, color: Color): Shot {
  return {
    x: LAUNCH_X,
    y: LAUNCH_Y,
    vx: Math.cos(angle) * SHOT_SPEED,
    vy: -Math.sin(angle) * SHOT_SPEED,
    color,
    bounces: 0,
  };
}

/** True when a shot centred at (x, y) touches the ceiling or any orb. */
export function collides(grid: Grid, x: number, y: number): boolean {
  if (y - R <= 0) return true;
  const r0 = Math.round((y - R) / ROW_H);
  for (let r = Math.max(0, r0 - 1); r <= r0 + 1; r++) {
    const row = grid.rows[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c] === null) continue;
      const p = grid.center(r, c);
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < HIT_DIST * HIT_DIST) return true;
    }
  }
  return false;
}

/**
 * Advance a shot by dt seconds in small sub-steps (so fast shots can't tunnel
 * through orbs), bouncing off the side walls. Returns true once it lands.
 */
export function stepShot(grid: Grid, s: Shot, dt: number): boolean {
  const dist = Math.hypot(s.vx, s.vy) * dt;
  const n = Math.max(1, Math.ceil(dist / (R / 4)));
  for (let i = 0; i < n; i++) {
    s.x += (s.vx * dt) / n;
    s.y += (s.vy * dt) / n;
    if (s.x < R) {
      s.x = R + (R - s.x);
      s.vx = Math.abs(s.vx);
      s.bounces++;
    } else if (s.x > W - R) {
      s.x = W - R - (s.x - (W - R));
      s.vx = -Math.abs(s.vx);
      s.bounces++;
    }
    if (collides(grid, s.x, s.y)) return true;
  }
  return false;
}

export interface AimPath {
  points: Point[]; // launcher -> bounces -> end of the prediction
  bounces: number;
  /** True if the path ends where the shot would actually stick (not just where the guide gives up). */
  landed: boolean;
}

/** Predicts where a shot at `angle` will go (used for the dotted aim guide). */
export function tracePath(grid: Grid, angle: number, maxBounces = 2, maxLen = 1600): AimPath {
  const shot = makeShot(angle, 0);
  const stepLen = 3;
  const dt = stepLen / SHOT_SPEED;
  const points: Point[] = [{ x: shot.x, y: shot.y }];
  let travelled = 0;
  let lastBounces = 0;
  let landed = false;
  while (travelled < maxLen) {
    landed = stepShot(grid, shot, dt);
    travelled += stepLen;
    if (shot.bounces !== lastBounces) {
      lastBounces = shot.bounces;
      points.push({ x: shot.x, y: shot.y });
      if (lastBounces > maxBounces) break;
    }
    if (landed) break;
  }
  points.push({ x: shot.x, y: shot.y });
  return { points, bounces: lastBounces, landed };
}
