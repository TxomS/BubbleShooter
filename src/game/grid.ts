import { COLS, D, R, ROW_H } from './config';

export type Color = number; // 0..ORB_TYPES-1

export interface Cell {
  r: number;
  c: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Hex-packed orb grid. Rows alternate between "full" (COLS cells) and
 * "offset" (COLS - 1 cells, shifted right by half an orb).
 *
 * When the ceiling drops, a new row is pushed on top and every existing row
 * moves down one index. `parity` flips so each row keeps its horizontal
 * offset and nothing visually slides sideways.
 */
export class Grid {
  rows: (Color | null)[][] = [];
  parity = 0;

  isOffset(r: number): boolean {
    return ((r + this.parity) & 1) === 1;
  }

  rowLength(r: number): number {
    return this.isOffset(r) ? COLS - 1 : COLS;
  }

  inBounds(r: number, c: number): boolean {
    return r >= 0 && c >= 0 && c < this.rowLength(r);
  }

  get(r: number, c: number): Color | null {
    if (!this.inBounds(r, c)) return null;
    return this.rows[r]?.[c] ?? null;
  }

  set(r: number, c: number, color: Color | null): void {
    if (!this.inBounds(r, c)) throw new Error(`cell out of bounds: ${r},${c}`);
    this.ensureRow(r);
    this.rows[r][c] = color;
  }

  ensureRow(r: number): void {
    while (this.rows.length <= r) {
      this.rows.push(new Array<Color | null>(this.rowLength(this.rows.length)).fill(null));
    }
  }

  center(r: number, c: number): Point {
    return { x: R + c * D + (this.isOffset(r) ? R : 0), y: R + r * ROW_H };
  }

  neighbors(r: number, c: number): Cell[] {
    const out: Cell[] = [];
    const add = (rr: number, cc: number) => {
      if (this.inBounds(rr, cc)) out.push({ r: rr, c: cc });
    };
    add(r, c - 1);
    add(r, c + 1);
    // An offset row sits half an orb to the right, so its upper/lower
    // neighbours are columns c and c+1; a full row's are c-1 and c.
    const [a, b] = this.isOffset(r) ? [0, 1] : [-1, 0];
    for (const rr of [r - 1, r + 1]) {
      add(rr, c + a);
      add(rr, c + b);
    }
    return out;
  }

  /** Length the new top row will have once pushRowTop flips the parity. */
  nextTopRowLength(): number {
    return (this.parity ^ 1) === 1 ? COLS - 1 : COLS;
  }

  /** Push a new row on top; everything else moves down one row. */
  pushRowTop(row: (Color | null)[]): void {
    this.parity ^= 1;
    const len = this.rowLength(0);
    const fixed = row.slice(0, len);
    while (fixed.length < len) fixed.push(null);
    this.rows.unshift(fixed);
  }

  occupied(): Cell[] {
    const out: Cell[] = [];
    this.rows.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v !== null) out.push({ r, c });
      }),
    );
    return out;
  }

  count(): number {
    let n = 0;
    for (const row of this.rows) for (const v of row) if (v !== null) n++;
    return n;
  }

  isEmpty(): boolean {
    return this.count() === 0;
  }

  /** Distinct colours still on the board. */
  colorsPresent(): Color[] {
    const seen = new Set<Color>();
    for (const row of this.rows) for (const v of row) if (v !== null) seen.add(v);
    return [...seen].sort((a, b) => a - b);
  }

  /** Index of the lowest occupied row, or -1 when empty. */
  maxRow(): number {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      if (this.rows[r].some((v) => v !== null)) return r;
    }
    return -1;
  }

  clone(): Grid {
    const g = new Grid();
    g.parity = this.parity;
    g.rows = this.rows.map((row) => row.slice());
    return g;
  }
}
