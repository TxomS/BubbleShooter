// All tunable numbers live here. Geometry is in "logical units"; the renderer
// scales the whole board to fit any screen.

export const R = 20; // orb radius
export const D = R * 2; // orb diameter
export const ROW_H = R * Math.sqrt(3); // vertical distance between hex rows
export const COLS = 11; // orbs in a full row (offset rows hold COLS - 1)
export const W = COLS * D; // board width

export const ROWS_ALLOWED = 14; // an orb in row >= this means game over
export const LOSE_Y = R + (ROWS_ALLOWED - 1) * ROW_H + R; // "event horizon" line
export const LAUNCH_X = W / 2;
export const LAUNCH_Y = LOSE_Y + 74;
export const H = LAUNCH_Y + 66; // total logical height

export const SHOT_SPEED = 1000; // logical units per second
export const HIT_DIST = D * 0.9; // how close a shot must get to an orb to stick
export const MIN_MATCH = 3;
export const MIN_ANGLE = 0.2; // radians above horizontal (keeps shots from going flat)
export const MAX_ANGLE = Math.PI - 0.2;
export const POP_STAGGER = 0.04; // seconds between chain-reaction pops

// Does a popping shot reset the "ceiling drops" counter? Classic feel says no:
// only misses count, and the counter clears when a new row arrives.
export const RESET_MISSES_ON_POP = false;

export const ORB_TYPES = 6;

/** What one level looks like. Each mode (src/game/modes.ts) decides these per level. */
export interface LevelConfig {
  rows: number; // how many rows the board starts with
  colors: number; // how many planet types are in play
  missLimit: number; // misses before the ceiling drops a row
}

export interface Rank {
  name: string;
  min: number; // score needed
  hue: number; // nebula tint
}

export const RANKS: Rank[] = [
  { name: 'Stargazer', min: 0, hue: 255 },
  { name: 'Cadet', min: 400, hue: 275 },
  { name: 'Pilot', min: 1200, hue: 205 },
  { name: 'Navigator', min: 2800, hue: 170 },
  { name: 'Commander', min: 5500, hue: 320 },
  { name: 'Astronomer', min: 9500, hue: 20 },
  { name: 'Galactic Captain', min: 15000, hue: 45 },
  { name: 'Cosmic Legend', min: 25000, hue: 290 },
];
