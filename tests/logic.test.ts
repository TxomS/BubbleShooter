import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLS, D, LAUNCH_X, ORB_TYPES, R, ROW_H, ROWS_ALLOWED, W } from '../src/game/config';
import { Grid } from '../src/game/grid';
import { generateBoard, generateRow } from '../src/game/level';
import { collides, findCluster, findFloating, makeShot, snapToCell, stepShot, tracePath } from '../src/game/logic';
import { DIFFICULTIES, LEVELS_PER_MODE, MODES, MODE_IDS } from '../src/game/modes';
import { mulberry32 } from '../src/game/rng';
import { LocalScoreStore, loadPrefs, savePrefs } from '../src/storage/scores';
import { dropPoints, popPoints, rankFor } from '../src/game/score';
import { Game, type GameEvent } from '../src/game/state';

function fullGrid(rows: number, colorAt: (r: number, c: number) => number): Grid {
  const g = new Grid();
  for (let r = 0; r < rows; r++) for (let c = 0; c < g.rowLength(r); c++) g.set(r, c, colorAt(r, c));
  return g;
}

describe('grid geometry', () => {
  it('rows alternate between COLS and COLS-1 cells', () => {
    const g = new Grid();
    expect(g.rowLength(0)).toBe(COLS);
    expect(g.rowLength(1)).toBe(COLS - 1);
    expect(g.rowLength(2)).toBe(COLS);
  });

  it('neighbours are symmetric and exactly one orb-diameter apart', () => {
    const g = new Grid();
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < g.rowLength(r); c++) {
        const ns = g.neighbors(r, c);
        expect(ns.length).toBeLessThanOrEqual(6);
        for (const n of ns) {
          const a = g.center(r, c);
          const b = g.center(n.r, n.c);
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(D, 5);
          expect(g.neighbors(n.r, n.c).some((m) => m.r === r && m.c === c)).toBe(true);
        }
      }
    }
  });

  it('an interior cell has six neighbours', () => {
    expect(new Grid().neighbors(3, 4)).toHaveLength(6);
  });

  it('all cell centres sit inside the board width', () => {
    const g = new Grid();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < g.rowLength(r); c++) {
        const p = g.center(r, c);
        expect(p.x - R).toBeGreaterThanOrEqual(0);
        expect(p.x + R).toBeLessThanOrEqual(W);
      }
    }
  });

  it('pushRowTop moves existing orbs down one row without shifting them sideways', () => {
    const g = fullGrid(3, () => 1);
    const before = g.center(1, 2);
    g.pushRowTop(new Array(g.nextTopRowLength()).fill(2));
    const after = g.center(2, 2);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y + ROW_H, 5);
    expect(g.get(0, 0)).toBe(2);
    expect(g.rows[0]).toHaveLength(g.rowLength(0));
    expect(g.rows).toHaveLength(4);
  });
});

describe('matching', () => {
  it('finds a connected same-colour cluster and ignores other colours', () => {
    const g = new Grid();
    g.set(0, 0, 1);
    g.set(0, 1, 1);
    g.set(1, 0, 1); // touches (0,0) and (0,1)
    g.set(0, 2, 2);
    g.set(0, 4, 1); // same colour but not connected
    const cluster = findCluster(g, 0, 0);
    expect(cluster).toHaveLength(3);
    expect(cluster.some((c) => c.r === 0 && c.c === 4)).toBe(false);
  });

  it('returns nothing for an empty cell', () => {
    expect(findCluster(new Grid(), 0, 0)).toEqual([]);
  });
});

describe('floating detection', () => {
  it('orbs hanging off the ceiling are kept', () => {
    const g = new Grid();
    g.set(0, 3, 1);
    g.set(1, 3, 2);
    g.set(2, 3, 3);
    expect(findFloating(g)).toEqual([]);
  });

  it('a disconnected group is reported as floating', () => {
    const g = new Grid();
    g.set(0, 0, 1);
    g.set(3, 5, 2);
    g.set(3, 6, 2);
    const floating = findFloating(g);
    expect(floating).toHaveLength(2);
    expect(floating.every((c) => c.r === 3)).toBe(true);
  });

  it('removing the only link makes the rest float', () => {
    const g = new Grid();
    g.set(0, 3, 1);
    g.set(1, 3, 2);
    g.set(2, 3, 3);
    g.set(0, 3, null);
    expect(findFloating(g)).toHaveLength(2);
  });
});

describe('snapping and shot physics', () => {
  it('snaps a shot below a ceiling orb into a touching free cell', () => {
    const g = new Grid();
    g.set(0, 5, 1);
    const cell = snapToCell(g, 232, 56);
    expect(cell.r).toBe(1);
    expect(g.neighbors(cell.r, cell.c).some((n) => n.r === 0 && n.c === 5)).toBe(true);
  });

  it('snaps to the top row when a shot hits the ceiling', () => {
    const cell = snapToCell(new Grid(), 100, R);
    expect(cell.r).toBe(0);
    expect(cell.c).toBe(2); // x = 20 + 2 * 40 = 100
  });

  it('never snaps into an occupied cell', () => {
    const g = fullGrid(2, () => 1);
    g.set(1, 4, null);
    expect(snapToCell(g, g.center(0, 4).x, g.center(0, 4).y + 5)).toEqual({ r: 1, c: 4 });
  });

  it('collides with the ceiling and with orbs, but not in open space', () => {
    const g = new Grid();
    g.set(0, 5, 1);
    expect(collides(g, 100, R)).toBe(true);
    expect(collides(g, LAUNCH_X, 70)).toBe(false);
    expect(collides(g, LAUNCH_X, 52)).toBe(true);
    expect(collides(g, 100, 300)).toBe(false);
  });

  it('bounces off the side walls', () => {
    const g = new Grid();
    const s = makeShot(0.5, 0); // heading up and to the right
    expect(s.vx).toBeGreaterThan(0);
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) landed = stepShot(g, s, 1 / 120);
    expect(landed).toBe(true);
    expect(s.bounces).toBeGreaterThan(0);
    expect(s.x).toBeGreaterThanOrEqual(R);
    expect(s.x).toBeLessThanOrEqual(W - R);
  });

  it('does not tunnel through an orb even with a huge time step', () => {
    const g = new Grid();
    g.set(5, 5, 1);
    const s = makeShot(Math.PI / 2, 0);
    s.x = g.center(5, 5).x;
    s.y = g.center(5, 5).y + 200;
    expect(stepShot(g, s, 0.5)).toBe(true);
    expect(s.y).toBeGreaterThan(g.center(5, 5).y);
  });

  it('tracePath ends at an orb and reports wall bounces', () => {
    const g = new Grid();
    g.set(0, 5, 1);
    const straight = tracePath(g, Math.PI / 2);
    expect(straight.bounces).toBe(0);
    const end = straight.points[straight.points.length - 1];
    expect(end.x).toBeCloseTo(LAUNCH_X, 0);
    expect(end.y).toBeLessThan(80);

    const angled = tracePath(g, 0.6);
    expect(angled.bounces).toBeGreaterThanOrEqual(1);
    expect(angled.points.length).toBeGreaterThanOrEqual(3);
  });
});

describe('scoring', () => {
  it('combo multiplier grows then caps', () => {
    expect(popPoints(3, 1)).toBe(30);
    expect(popPoints(3, 2)).toBe(45);
    expect(popPoints(3, 3)).toBe(60);
    expect(popPoints(3, 20)).toBe(90);
  });

  it('dropped orbs are worth double each, up to a cap', () => {
    expect(dropPoints(0)).toBe(0);
    expect(dropPoints(1)).toBe(20);
    expect(dropPoints(3)).toBe(20 + 40 + 80);
    expect(dropPoints(10)).toBe(20 + 40 + 80 + 160 * 7);
  });

  it('ranks by score with progress to the next one', () => {
    expect(rankFor(0).rank.name).toBe('Stargazer');
    expect(rankFor(400).rank.name).toBe('Cadet');
    expect(rankFor(200).progress).toBeCloseTo(0.5, 5);
    const top = rankFor(1e9);
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
  });
});

describe('board generation', () => {
  it('uses only the allowed colours and fills the right number of rows', () => {
    const cfg = MODES.medium.config(1);
    const g = generateBoard(cfg, mulberry32(7));
    expect(g.rows).toHaveLength(cfg.rows);
    expect(g.colorsPresent().every((c) => c < cfg.colors)).toBe(true);
    expect(g.count()).toBe(Array.from({ length: cfg.rows }, (_, r) => g.rowLength(r)).reduce((a, b) => a + b, 0));
  });

  it('is deterministic for a given seed', () => {
    const a = generateBoard(MODES.hard.config(3), mulberry32(42));
    const b = generateBoard(MODES.hard.config(3), mulberry32(42));
    expect(a.rows).toEqual(b.rows);
  });

  it('new rows only use colours still on the board and match the next row length', () => {
    const g = fullGrid(3, (r) => (r % 2 ? 2 : 4));
    const row = generateRow(g, mulberry32(1));
    expect(row).toHaveLength(g.nextTopRowLength());
    expect(row.every((c) => c === 2 || c === 4)).toBe(true);
  });

});

describe('modes', () => {
  it('every campaign has five levels with sane settings that never get easier', () => {
    for (const id of DIFFICULTIES) {
      const mode = MODES[id];
      expect(mode.levels).toBe(LEVELS_PER_MODE);
      let prev = mode.config(1);
      for (let level = 1; level <= LEVELS_PER_MODE; level++) {
        const cfg = mode.config(level);
        expect(cfg.colors).toBeGreaterThanOrEqual(3);
        expect(cfg.colors).toBeLessThanOrEqual(ORB_TYPES);
        expect(cfg.rows).toBeGreaterThanOrEqual(1);
        expect(cfg.rows).toBeLessThan(ROWS_ALLOWED - 2); // never start next to the horizon
        expect(cfg.missLimit).toBeGreaterThanOrEqual(2);
        expect(cfg.rows).toBeGreaterThanOrEqual(prev.rows);
        expect(cfg.colors).toBeGreaterThanOrEqual(prev.colors);
        expect(cfg.missLimit).toBeLessThanOrEqual(prev.missLimit);
        prev = cfg;
      }
    }
  });

  it('each difficulty is harder than the one before it', () => {
    for (const level of [1, LEVELS_PER_MODE]) {
      for (let i = 1; i < DIFFICULTIES.length; i++) {
        const easier = MODES[DIFFICULTIES[i - 1]].config(level);
        const harder = MODES[DIFFICULTIES[i]].config(level);
        expect(harder.rows).toBeGreaterThanOrEqual(easier.rows);
        expect(harder.colors).toBeGreaterThanOrEqual(easier.colors);
        expect(harder.missLimit).toBeLessThanOrEqual(easier.missLimit);
      }
    }
    // The bank-shot preview shrinks as the mode gets harder.
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      expect(MODES[DIFFICULTIES[i]].guideBounces).toBeLessThanOrEqual(MODES[DIFFICULTIES[i - 1]].guideBounces);
    }
  });

  it('endless has no end, ramps up gently, and stays within limits', () => {
    const m = MODES.endless;
    expect(m.levels).toBeNull();
    expect(m.config(1).missLimit).toBeGreaterThan(MODES.hard.config(1).missLimit);
    for (let wave = 1; wave <= 60; wave++) {
      const cfg = m.config(wave);
      expect(cfg.colors).toBeLessThanOrEqual(ORB_TYPES);
      expect(cfg.rows).toBeLessThanOrEqual(8);
      expect(cfg.missLimit).toBeGreaterThanOrEqual(4);
    }
    expect(m.config(30).colors).toBe(ORB_TYPES);
    expect(m.config(30).rows).toBeGreaterThan(m.config(1).rows);
  });

  it('lists every mode once', () => {
    expect(new Set(MODE_IDS).size).toBe(5);
    expect(MODE_IDS.every((id) => MODES[id].id === id)).toBe(true);
  });
});

describe('Game', () => {
  const run = (game: Game, events: GameEvent[] = []) => {
    game.on((e) => events.push(e));
    game.fire();
    for (let i = 0; i < 1200 && game.phase === 'flying'; i++) game.update(1 / 60);
    return events;
  };

  it('starts a fresh game ready to aim, with colours that exist on the board', () => {
    const game = new Game(1);
    game.newGame();
    expect(game.phase).toBe('aiming');
    const present = game.grid.colorsPresent();
    expect(present).toContain(game.current);
    expect(present).toContain(game.next);
  });

  it('pops a match of three and scores it', () => {
    const game = new Game(1);
    game.newGame();
    const g = new Grid();
    g.set(0, 5, 0);
    g.set(0, 6, 0);
    g.set(0, 0, 1); // keeps the board from being cleared
    game.grid = g;
    game.current = 0;
    game.setAngle(Math.PI / 2);
    const events = run(game);
    const pop = events.find((e) => e.type === 'pop');
    expect(pop && pop.type === 'pop' && pop.orbs.length).toBe(3); // two reds + the shot
    expect(game.score).toBe(30);
    expect(game.grid.count()).toBe(1); // just the blue
    expect(game.phase).toBe('settling');
  });

  it('drops orbs that lose their link to the ceiling', () => {
    const game = new Game(1);
    game.newGame();
    const g = new Grid();
    // Two reds on the ceiling; a blue hangs off the right one and has no other support.
    g.set(0, 5, 0);
    g.set(0, 6, 0);
    g.set(1, 6, 1);
    g.set(0, 0, 2); // keeps the board from being cleared
    game.grid = g;
    game.current = 0;
    game.setAngle(Math.PI / 2);
    const events = run(game);
    const drop = events.find((e) => e.type === 'drop');
    expect(drop && drop.type === 'drop' && drop.orbs.length).toBe(1);
    expect(game.score).toBe(30 + 20); // 3 popped + 1 dropped
    expect(findFloating(game.grid)).toEqual([]);
    expect(game.grid.count()).toBe(1);
  });

  it('counts a miss, and drops a new row once the miss limit is reached', () => {
    const game = new Game(1);
    game.newGame();
    const g = new Grid();
    g.set(0, 5, 1);
    g.set(0, 0, 2);
    game.grid = g;
    game.current = 3; // different colour from everything -> a miss
    game.missLimit = 1;
    const parity = g.parity;
    const events = run(game);
    expect(events.some((e) => e.type === 'rowAdded')).toBe(true);
    expect(game.misses).toBe(0);
    expect(game.grid.parity).toBe(parity ^ 1);
    expect(game.combo).toBe(0);
  });

  it('ends the game when orbs reach the event horizon', () => {
    const game = new Game(1);
    game.newGame();
    // A full wall of alternating colours, none matching the shot colour.
    game.grid = fullGrid(ROWS_ALLOWED, (r, c) => 1 + ((r + c) % 2));
    game.current = 0;
    const events = run(game);
    expect(game.phase).toBe('lost');
    expect(events.some((e) => e.type === 'lost')).toBe(true);
  });

  it('wins when the board is cleared and awards a bonus', () => {
    const game = new Game(1);
    game.newGame();
    const g = new Grid();
    g.set(0, 4, 0);
    g.set(0, 5, 0);
    game.grid = g;
    game.current = 0;
    game.setAngle(Math.PI / 2);
    const events = run(game);
    expect(game.phase).toBe('won');
    const won = events.find((e) => e.type === 'won');
    expect(won && won.type === 'won' && won.bonus).toBe(500);
    game.nextLevel();
    expect(game.level).toBe(2);
    expect(game.phase).toBe('aiming');
  });

  it('only allows firing while aiming, and clamps the aim angle', () => {
    const game = new Game(1);
    game.newGame();
    game.setAngle(0);
    expect(game.angle).toBeGreaterThan(0.1);
    game.setAngle(10);
    expect(game.angle).toBeLessThan(Math.PI - 0.1);
    expect(game.fire()).toBe(true);
    expect(game.fire()).toBe(false);
  });

  it('emits rank-ups as the score grows', () => {
    const game = new Game(1);
    game.newGame();
    const events: GameEvent[] = [];
    game.on((e) => events.push(e));
    // Clear a tiny board for the 500 bonus -> crosses the first rank threshold (400).
    const g = new Grid();
    g.set(0, 4, 0);
    g.set(0, 5, 0);
    game.grid = g;
    game.current = 0;
    game.fire();
    for (let i = 0; i < 1200 && game.phase === 'flying'; i++) game.update(1 / 60);
    expect(events.some((e) => e.type === 'rankUp')).toBe(true);
  });
});

describe('Game modes', () => {
  /** A two-orb board that the next straight shot clears. */
  const setUpWin = (game: Game) => {
    const g = new Grid();
    g.set(0, 4, 0);
    g.set(0, 5, 0);
    game.grid = g;
    game.current = 0;
    game.setAngle(Math.PI / 2);
  };
  const shoot = (game: Game, events: GameEvent[]) => {
    game.on((e) => events.push(e));
    game.fire();
    for (let i = 0; i < 1200 && game.phase === 'flying'; i++) game.update(1 / 60);
  };

  it('starts a campaign level with that level\'s own settings', () => {
    const game = new Game(3);
    game.newGame('hard', 3);
    const cfg = MODES.hard.config(3);
    expect(game.mode.id).toBe('hard');
    expect(game.level).toBe(3);
    expect(game.missLimit).toBe(cfg.missLimit);
    expect(game.grid.rows).toHaveLength(cfg.rows);
    expect(game.grid.colorsPresent().every((c) => c < cfg.colors)).toBe(true);
  });

  it('restarts from where the run began, and a new mode starts at level 1', () => {
    const game = new Game(3);
    game.newGame('medium', 3);
    game.nextLevel();
    expect(game.level).toBe(4);
    game.newGame(); // Restart
    expect(game.level).toBe(3);
    expect(game.score).toBe(0);
    game.newGame('easy');
    expect(game.mode.id).toBe('easy');
    expect(game.level).toBe(1);
  });

  it('keeps the start level inside the campaign', () => {
    const game = new Game(3);
    game.newGame('easy', 99);
    expect(game.level).toBe(LEVELS_PER_MODE);
    game.newGame('easy', 0);
    expect(game.level).toBe(1);
  });

  it('only the last level of a campaign is final', () => {
    const game = new Game(3);
    game.newGame('easy', 2);
    setUpWin(game);
    const first: GameEvent[] = [];
    shoot(game, first);
    const won = first.find((e) => e.type === 'won');
    expect(won && won.type === 'won' && [won.final, won.endless]).toEqual([false, false]);

    game.newGame('easy', LEVELS_PER_MODE);
    setUpWin(game);
    const last: GameEvent[] = [];
    shoot(game, last);
    const done = last.find((e) => e.type === 'won');
    expect(done && done.type === 'won' && done.final).toBe(true);
  });

  it('endless glides into the next wave by itself and keeps the score', () => {
    const game = new Game(3);
    game.newGame('endless');
    setUpWin(game);
    const events: GameEvent[] = [];
    shoot(game, events);
    const won = events.find((e) => e.type === 'won');
    expect(won && won.type === 'won' && [won.final, won.endless]).toEqual([false, true]);
    expect(game.phase).toBe('won');
    const kept = game.score;
    expect(kept).toBeGreaterThan(0);

    game.update(0.5);
    expect(game.phase).toBe('won'); // still catching its breath
    game.update(2);
    expect(game.phase).toBe('aiming');
    expect(game.level).toBe(2);
    expect(game.score).toBe(kept);
    expect(game.grid.isEmpty()).toBe(false);
  });

  it('a campaign level waits for the player instead of advancing by itself', () => {
    const game = new Game(3);
    game.newGame('medium');
    setUpWin(game);
    shoot(game, []);
    game.update(10);
    expect(game.phase).toBe('won');
    expect(game.level).toBe(1);
  });
});

describe('saved data', () => {
  let data: Record<string, string>;
  beforeEach(() => {
    data = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const entry = (score: number, name = 'Pilot') => ({ name, score, level: 1, date: score });

  it('keeps a separate leaderboard for every mode', () => {
    const store = new LocalScoreStore();
    store.add('easy', entry(500));
    store.add('endless', entry(900));
    expect(store.top('easy').map((e) => e.score)).toEqual([500]);
    expect(store.top('endless').map((e) => e.score)).toEqual([900]);
    expect(store.top('hard')).toEqual([]);
    expect(store.best('endless')).toBe(900);
    store.clear('easy');
    expect(store.top('easy')).toEqual([]);
    expect(store.top('endless')).toHaveLength(1); // clearing one mode leaves the rest alone
  });

  it('keeps ten scores, best first, and says who qualifies', () => {
    const store = new LocalScoreStore();
    for (let i = 1; i <= 12; i++) store.add('medium', entry(i * 100));
    const top = store.top('medium');
    expect(top).toHaveLength(10);
    expect(top[0].score).toBe(1200);
    expect(top[9].score).toBe(300);
    expect(store.qualifies('medium', 250)).toBe(false);
    expect(store.qualifies('medium', 350)).toBe(true);
    expect(store.qualifies('medium', 0)).toBe(false);
    expect(store.qualifies('hard', 10)).toBe(true); // an empty board is easy to qualify for
  });

  it('moves a score list saved before modes existed into Endless', () => {
    data['bubbleshooter.scores.v1'] = JSON.stringify([entry(900, 'Old')]);
    const store = new LocalScoreStore();
    expect(store.top('endless').map((e) => e.name)).toEqual(['Old']);
    expect(store.top('easy')).toEqual([]);
    store.add('easy', entry(100));
    expect(store.top('endless')).toHaveLength(1); // still there after the first save
  });

  it('survives corrupt saved data', () => {
    data['bubbleshooter.scores.v2'] = JSON.stringify({ easy: 'oops', hard: [null, { score: 'x' }, entry(5)] });
    data['bubbleshooter.prefs.v1'] = JSON.stringify({ sfx: 7, music: 'loud', lastMode: 'nope', name: 42 });
    const store = new LocalScoreStore();
    expect(store.top('easy')).toEqual([]);
    expect(store.top('hard').map((e) => e.score)).toEqual([5]);
    const prefs = loadPrefs();
    expect(prefs.sfx).toBe(1);
    expect(prefs.music).toBe(0.6);
    expect(prefs.lastMode).toBe('endless');
    expect(prefs.name).toBe('');
  });

  it('remembers audio and name preferences, with music and sound effects independent', () => {
    expect(loadPrefs()).toMatchObject({ musicOn: true, sfxOn: true, music: 0.6, sfx: 1 });
    savePrefs({ music: 0.25, sfxOn: false, lastMode: 'hard' });
    savePrefs({ name: 'Mia' });
    // Turning sound effects off leaves the music switch alone.
    expect(loadPrefs()).toMatchObject({ musicOn: true, music: 0.25, sfxOn: false, lastMode: 'hard', name: 'Mia' });
  });

  it('ignores the old mute and master settings, so they cannot silence the music', () => {
    data['bubbleshooter.prefs.v1'] = JSON.stringify({ muted: true, master: 0 });
    expect(loadPrefs()).toMatchObject({ musicOn: true, sfxOn: true });
  });
});
