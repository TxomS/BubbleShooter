import { MAX_ANGLE, MIN_ANGLE, MIN_MATCH, RESET_MISSES_ON_POP, ROWS_ALLOWED, type Rank } from './config';
import { Grid, type Cell, type Color, type Point } from './grid';
import { generateBoard, generateRow } from './level';
import { findCluster, findFloating, makeShot, snapToCell, stepShot, type Shot } from './logic';
import { MODES, type ModeDef, type ModeId } from './modes';
import { mulberry32, pick, type Rng } from './rng';
import { dropPoints, popPoints, rankFor } from './score';

export type Phase = 'aiming' | 'flying' | 'settling' | 'won' | 'lost';

export interface Orb extends Cell, Point {
  color: Color;
}

/** Everything the renderer, sound and HUD need to react to. The game itself knows nothing about them. */
export type GameEvent =
  | { type: 'launch'; color: Color }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'land'; fromX: number; fromY: number; x: number; y: number; r: number; c: number; color: Color }
  | { type: 'pop'; orbs: Orb[]; combo: number; points: number; origin: Point }
  | { type: 'drop'; orbs: Orb[]; points: number }
  | { type: 'rowAdded' }
  | { type: 'score'; score: number; delta: number }
  | { type: 'rankUp'; rank: Rank; index: number }
  | { type: 'level'; level: number }
  /** `final`: that was the last level of a campaign mode. `endless`: the next wave starts by itself. */
  | { type: 'won'; level: number; bonus: number; final: boolean; endless: boolean }
  | { type: 'lost'; score: number; level: number };

type Listener = (e: GameEvent) => void;

/** How long the cleared board lingers before an Endless wave glides in. */
const NEXT_WAVE_DELAY = 1.7;

export class Game {
  grid = new Grid();
  mode: ModeDef = MODES.medium;
  /** The level this run began at (Restart goes back here). */
  startLevel = 1;
  level = 1;
  score = 0;
  combo = 0;
  misses = 0;
  missLimit = 5;
  current: Color = 0;
  next: Color = 0;
  phase: Phase = 'aiming';
  angle = Math.PI / 2;
  shot: Shot | null = null;

  private settle = 0;
  private nextWave = 0;
  private rankIndex = 0;
  private rng: Rng;
  private listeners = new Set<Listener>();

  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) {
    this.rng = mulberry32(seed);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: GameEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /**
   * Starts a fresh run with the score back at zero. With no arguments it restarts
   * the current mode from the level the run began at.
   */
  newGame(mode: ModeId = this.mode.id, level?: number): void {
    const start = level ?? (mode === this.mode.id ? this.startLevel : 1);
    this.mode = MODES[mode];
    this.level = Math.max(1, Math.min(start, this.mode.levels ?? start));
    this.startLevel = this.level;
    this.score = 0;
    this.rankIndex = 0;
    this.emit({ type: 'score', score: 0, delta: 0 });
    this.beginLevel();
  }

  nextLevel(): void {
    this.level++;
    this.beginLevel();
  }

  private beginLevel(): void {
    this.nextWave = 0;
    const cfg = this.mode.config(this.level);
    this.grid = generateBoard(cfg, this.rng);
    this.missLimit = cfg.missLimit;
    this.misses = 0;
    this.combo = 0;
    this.shot = null;
    this.current = this.pickColor();
    this.next = this.pickColor();
    this.phase = 'aiming';
    this.emit({ type: 'level', level: this.level });
  }

  setAngle(angle: number): void {
    this.angle = Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, angle));
  }

  fire(): boolean {
    if (this.phase !== 'aiming') return false;
    this.shot = makeShot(this.angle, this.current);
    this.phase = 'flying';
    this.emit({ type: 'launch', color: this.current });
    return true;
  }

  update(dt: number): void {
    if (this.phase === 'flying' && this.shot) {
      const before = this.shot.bounces;
      const landed = stepShot(this.grid, this.shot, dt);
      if (this.shot.bounces > before) this.emit({ type: 'bounce', x: this.shot.x, y: this.shot.y });
      if (landed) this.land();
    } else if (this.phase === 'settling') {
      this.settle -= dt;
      if (this.settle <= 0) this.phase = 'aiming';
    } else if (this.phase === 'won' && this.nextWave > 0) {
      // Endless mode: after a short breather the next wave glides in on its own.
      this.nextWave -= dt;
      if (this.nextWave <= 0) this.nextLevel();
    }
  }

  private land(): void {
    const shot = this.shot!;
    this.shot = null;
    const grid = this.grid;

    const cell = snapToCell(grid, shot.x, shot.y);
    grid.set(cell.r, cell.c, shot.color);
    const at = grid.center(cell.r, cell.c);
    this.emit({ type: 'land', fromX: shot.x, fromY: shot.y, x: at.x, y: at.y, r: cell.r, c: cell.c, color: shot.color });

    let rowAdded = false;
    let popped = false;
    const cluster = findCluster(grid, cell.r, cell.c);

    if (cluster.length >= MIN_MATCH) {
      popped = true;
      this.combo++;
      const orbs = this.takeOrbs(cluster).sort(
        (a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y),
      );
      const points = popPoints(orbs.length, this.combo);
      this.emit({ type: 'pop', orbs, combo: this.combo, points, origin: at });

      const floating = findFloating(grid);
      let dropTotal = 0;
      if (floating.length) {
        const dropped = this.takeOrbs(floating).sort((a, b) => a.y - b.y);
        dropTotal = dropPoints(dropped.length);
        this.emit({ type: 'drop', orbs: dropped, points: dropTotal });
      }
      this.addScore(points + dropTotal);
      if (RESET_MISSES_ON_POP) this.misses = 0;
    } else {
      this.combo = 0;
      this.misses++;
      if (this.misses >= this.missLimit) {
        this.misses = 0;
        grid.pushRowTop(generateRow(grid, this.rng));
        rowAdded = true;
        this.emit({ type: 'rowAdded' });
      }
    }

    if (grid.isEmpty()) {
      const bonus = 500 * Math.min(this.level, 10);
      this.addScore(bonus);
      this.phase = 'won';
      const endless = this.mode.levels === null;
      const final = !endless && this.level >= (this.mode.levels as number);
      if (endless) this.nextWave = NEXT_WAVE_DELAY;
      this.emit({ type: 'won', level: this.level, bonus, final, endless });
      return;
    }
    if (grid.maxRow() >= ROWS_ALLOWED) {
      this.phase = 'lost';
      this.emit({ type: 'lost', score: this.score, level: this.level });
      return;
    }

    this.advanceQueue();
    this.phase = 'settling';
    this.settle = rowAdded ? 0.5 : popped ? 0.12 : 0.1;
  }

  /** Remove cells from the grid and describe them (position + colour) for the effects layer. */
  private takeOrbs(cells: Cell[]): Orb[] {
    return cells.map(({ r, c }) => {
      const color = this.grid.get(r, c)!;
      const p = this.grid.center(r, c);
      this.grid.set(r, c, null);
      return { r, c, x: p.x, y: p.y, color };
    });
  }

  private addScore(delta: number): void {
    if (delta <= 0) return;
    this.score += delta;
    this.emit({ type: 'score', score: this.score, delta });
    const info = rankFor(this.score);
    if (info.index > this.rankIndex) {
      this.rankIndex = info.index;
      this.emit({ type: 'rankUp', rank: info.rank, index: info.index });
    }
  }

  /** Only ever hand the player colours that are still on the board. */
  private pickColor(): Color {
    const present = this.grid.colorsPresent();
    return pick(this.rng, present.length ? present : [0]);
  }

  private advanceQueue(): void {
    const present = this.grid.colorsPresent();
    this.current = present.includes(this.next) ? this.next : this.pickColor();
    this.next = this.pickColor();
  }
}
