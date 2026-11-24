import { H, LAUNCH_X, LAUNCH_Y, LOSE_Y, R, RANKS, ROW_H, ROWS_ALLOWED, W } from '../game/config';
import type { Point } from '../game/grid';
import { tracePath, type AimPath } from '../game/logic';
import { rankFor } from '../game/score';
import type { Game, GameEvent } from '../game/state';
import { Background } from './background';
import { Effects } from './effects';
import { ORB_STYLES, OrbSprites, SPRITE_L, paintOrb } from './sprites';

// Planets that drift behind the menu: [planet, x, y, size, speed, phase]. x, y and size are fractions
// of the screen (size is of its shorter side). Portrait keeps them above and below the buttons;
// wide screens park them at the sides.
type MenuPlanet = readonly [number, number, number, number, number, number];
const MENU_PORTRAIT: MenuPlanet[] = [
  [5, 0.2, 0.09, 0.3, 0.22, 0.0],
  [3, 0.9, 0.13, 0.15, 0.3, 1.7],
  [1, 0.1, 0.9, 0.18, 0.26, 3.1],
  [2, 0.8, 0.92, 0.3, 0.18, 4.4],
  [4, 0.56, 0.035, 0.08, 0.35, 2.3],
];
const MENU_WIDE: MenuPlanet[] = [
  [5, 0.12, 0.25, 0.3, 0.22, 0.0],
  [3, 0.8, 0.18, 0.15, 0.3, 1.7],
  [1, 0.17, 0.82, 0.17, 0.26, 3.1],
  [2, 0.88, 0.72, 0.34, 0.18, 4.4],
  [4, 0.06, 0.55, 0.1, 0.35, 2.3],
  [0, 0.94, 0.45, 0.09, 0.28, 5.2],
];

const NEXT_X = LAUNCH_X - 112;
const NEXT_Y = LAUNCH_Y + 4;
const PIPS_X = LAUNCH_X + 112;
const PIPS_Y = LAUNCH_Y + 2;
const FONT = '"Space Grotesk Variable", system-ui, sans-serif';
const FRAME_TOP = 16; // how far the glass frame extends above the ceiling line

interface LandAnim {
  t: number;
  fromX: number;
  fromY: number;
}

interface Twinkle {
  r: number;
  c: number;
  t: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class Renderer {
  readonly fx = new Effects();
  readonly bg = new Background();

  private ctx: CanvasRenderingContext2D;
  private sprites = new OrbSprites();
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  private time = 0;
  private boardShift = 0; // logical px; negative while the board slides down after a new row
  private loadT = 1; // 0..1 progress of the next orb sliding into the launcher
  private ceilFlash = 0;
  private landAnims = new Map<number, LandAnim>();
  private twinkles: Twinkle[] = [];
  private nextTwinkle = 0.4;
  private version = 0; // bumps whenever the board changes (invalidates the aim guide)
  private aim: { angle: number; version: number; path: AimPath } | null = null;
  private reduce = false;
  private tmp = { dx: 0, dy: 0 };
  private scene: 'menu' | 'game' = 'menu';
  private menuPlanets: HTMLCanvasElement[] = [];
  private menuPlanetDpr = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      this.reduce = mq.matches;
      this.fx.reduce = mq.matches;
      this.bg.reduceMotion = mq.matches;
    };
    apply();
    mq.addEventListener?.('change', apply);
    game.on((e) => this.onEvent(e));
  }

  /** Fit the board into the space below the HUD. Also publishes the board width for the HUD to match. */
  resize(topInset: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.dpr = dpr;
    this.vw = vw;
    this.vh = vh;
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);

    const padX = vw < 600 ? 8 : 24;
    const padBottom = 12;
    const availW = vw - padX * 2;
    const availH = vh - topInset - padBottom;
    // The glass frame pokes FRAME_TOP above the ceiling; leave room for it under the HUD.
    const extent = H + FRAME_TOP;
    this.scale = Math.max(0.2, Math.min(availW / W, availH / extent));
    this.ox = (vw - W * this.scale) / 2;
    this.oy = topInset + (availH - extent * this.scale) * 0.6 + FRAME_TOP * this.scale;

    this.sprites.ensure(this.scale * dpr);
    this.bg.resize(vw, vh);

    const root = document.documentElement.style;
    root.setProperty('--board-w', `${Math.round(Math.max(W * this.scale, Math.min(vw, 340)))}px`);
  }

  /** 'menu' draws only the nebula and drifting planets; 'game' draws the board. */
  setScene(scene: 'menu' | 'game') {
    this.scene = scene;
    if (scene === 'menu') this.bg.setHue(RANKS[0].hue); // back to the calm default tint
  }

  toLogical(clientX: number, clientY: number): Point {
    return { x: (clientX - this.ox) / this.scale, y: (clientY - this.oy) / this.scale };
  }

  private onEvent(e: GameEvent) {
    switch (e.type) {
      case 'bounce':
        this.fx.onBounce(e.x, e.y, this.game.shot?.color ?? 0);
        break;
      case 'land':
        this.landAnims.set(e.r * 16 + e.c, { t: 0, fromX: e.fromX, fromY: e.fromY });
        this.fx.addRipple(e.x, e.y, 3.6);
        this.fx.addSparks(e.x, e.y, ORB_STYLES[e.color].light, 4, 70, 0.3);
        this.loadT = 0;
        this.version++;
        break;
      case 'pop':
        this.fx.onPop(e.orbs, e.combo, e.points, e.origin);
        this.version++;
        break;
      case 'drop':
        this.fx.onDrop(e.orbs, e.points);
        this.version++;
        break;
      case 'rowAdded': {
        const moved = new Map<number, LandAnim>();
        for (const [k, a] of this.landAnims) {
          moved.set(k + 16, { ...a, fromY: a.fromY + ROW_H });
        }
        this.landAnims = moved;
        this.twinkles.length = 0;
        this.fx.shiftBoardItems(ROW_H);
        this.boardShift = -ROW_H;
        this.ceilFlash = 1;
        this.version++;
        break;
      }
      case 'level':
        this.fx.clear();
        this.landAnims.clear();
        this.twinkles.length = 0;
        this.loadT = 1;
        this.boardShift = this.reduce ? 0 : -260;
        this.version++;
        this.bg.setHue(rankFor(this.game.score).rank.hue);
        break;
      case 'rankUp':
        this.bg.setHue(e.rank.hue);
        if (!this.reduce) this.fx.pulse = 1;
        break;
      case 'won':
      case 'lost':
        if (!this.reduce) this.fx.pulse = 1;
        break;
      case 'score':
        break;
    }
  }

  frame(dt: number) {
    this.time += dt;
    const { ctx, dpr, scale } = this;

    if (this.scene === 'menu') {
      this.bg.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bg.draw(ctx, this.time);
      this.drawMenuPlanets(ctx);
      return;
    }

    this.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bg.draw(ctx, this.time);
    this.drawHorizon(ctx);

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * this.ox, dpr * this.oy);
    this.drawFrame(ctx);
    this.drawLoseLine(ctx);
    this.drawBoard(ctx);
    this.fx.drawRings(ctx);
    this.fx.drawFallers(ctx, this.sprites);
    if (this.game.phase === 'aiming' || this.game.phase === 'settling') this.drawGuide(ctx);
    this.drawLauncher(ctx);
    this.drawShot(ctx);
    this.fx.drawSparks(ctx);
    this.fx.drawPopups(ctx);
    this.drawPulse(ctx);
  }

  private update(dt: number) {
    this.bg.update(dt);
    this.fx.update(dt);
    this.boardShift *= Math.exp(-dt * 8);
    if (Math.abs(this.boardShift) < 0.05) this.boardShift = 0;
    this.loadT = Math.min(1, this.loadT + dt / 0.2);
    this.ceilFlash = Math.max(0, this.ceilFlash - dt * 2.5);

    for (const [k, a] of this.landAnims) {
      a.t += dt;
      if (a.t > 0.6) this.landAnims.delete(k);
    }

    for (let i = this.twinkles.length - 1; i >= 0; i--) {
      this.twinkles[i].t += dt;
      if (this.twinkles[i].t > 0.7) this.twinkles.splice(i, 1);
    }
    this.nextTwinkle -= dt;
    if (this.nextTwinkle <= 0 && !this.reduce) {
      this.nextTwinkle = 0.25 + Math.random() * 0.3;
      const cells = this.game.grid.occupied();
      if (cells.length) {
        const pick = cells[Math.floor(Math.random() * cells.length)];
        this.twinkles.push({ r: pick.r, c: pick.c, t: 0 });
      }
    }

    const shot = this.game.shot;
    if (shot) this.fx.trail(shot.x, shot.y, shot.color);
  }

  // ---- scenery ---------------------------------------------------------------

  /** Big, pre-rendered planets bobbing gently behind the menu. */
  private drawMenuPlanets(ctx: CanvasRenderingContext2D) {
    if (!this.menuPlanets.length || this.menuPlanetDpr !== this.dpr) {
      const px = Math.round(220 * this.dpr);
      this.menuPlanets = ORB_STYLES.map((style) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = px;
        const c = cv.getContext('2d')!;
        c.scale(px / SPRITE_L, px / SPRITE_L);
        paintOrb(c, style, SPRITE_L / 2, SPRITE_L / 2);
        return cv;
      });
      this.menuPlanetDpr = this.dpr;
    }

    const { vw, vh } = this;
    const layout = vh > vw * 1.1 ? MENU_PORTRAIT : MENU_WIDE;
    const base = Math.min(vw, vh);
    for (const [planet, fx, fy, size, speed, phase] of layout) {
      const d = base * size;
      const bobX = this.reduce ? 0 : Math.cos(this.time * speed + phase) * d * 0.07;
      const bobY = this.reduce ? 0 : Math.sin(this.time * speed * 1.3 + phase) * d * 0.09;
      const s = d * (SPRITE_L / (R * 2)); // the sprite canvas is bigger than the planet inside it (glow room)
      ctx.drawImage(this.menuPlanets[planet], vw * fx + bobX - s / 2, vh * fy + bobY - s / 2, s, s);
    }
  }

  /** A curved planet horizon behind the launcher, tinted by the current rank. */
  private drawHorizon(ctx: CanvasRenderingContext2D) {
    const hy = this.oy + (LAUNCH_Y + 42) * this.scale;
    if (hy > this.vh + 4) return;
    const rad = Math.max(this.vw * 1.15, 520);
    const cx = this.vw / 2;
    const cy = hy + rad;
    const hue = this.bg.hue;

    const body = ctx.createLinearGradient(0, hy, 0, hy + Math.min(220, this.vh - hy + 40));
    body.addColorStop(0, `hsla(${hue + 20}, 55%, 20%, 0.95)`);
    body.addColorStop(1, `hsla(${hue + 30}, 50%, 6%, 1)`);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();

    const rim = ctx.createLinearGradient(cx - rad * 0.6, 0, cx + rad * 0.6, 0);
    rim.addColorStop(0, `hsla(${hue}, 90%, 70%, 0)`);
    rim.addColorStop(0.5, `hsla(${hue}, 90%, 72%, 0.85)`);
    rim.addColorStop(1, `hsla(${hue}, 90%, 70%, 0)`);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy - 4, rad, Math.PI * 1.25, Math.PI * 1.75);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawFrame(ctx: CanvasRenderingContext2D) {
    const x = -10;
    const y = -FRAME_TOP;
    const w = W + 20;
    const h = LOSE_Y + 36;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, 'rgba(130,150,255,0.10)');
    fill.addColorStop(1, 'rgba(20,24,80,0.26)');
    ctx.fillStyle = fill;
    ctx.fill();
    const stroke = ctx.createLinearGradient(0, y, 0, y + h);
    stroke.addColorStop(0, 'rgba(160,180,255,0.42)');
    stroke.addColorStop(1, 'rgba(160,180,255,0.14)');
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The ceiling: a force-field bar that flares when it descends.
    const flash = this.ceilFlash;
    const bar = ctx.createLinearGradient(-6, 0, W + 6, 0);
    bar.addColorStop(0, 'rgba(90,220,255,0.0)');
    bar.addColorStop(0.2, `rgba(110,200,255,${0.65 + flash * 0.35})`);
    bar.addColorStop(0.5, `rgba(190,140,255,${0.75 + flash * 0.25})`);
    bar.addColorStop(0.8, `rgba(110,200,255,${0.65 + flash * 0.35})`);
    bar.addColorStop(1, 'rgba(90,220,255,0.0)');
    ctx.strokeStyle = bar;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.lineTo(W + 6, -2);
    ctx.stroke();
    ctx.globalAlpha = 0.14 + flash * 0.3;
    ctx.lineWidth = 9 + flash * 10;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawLoseLine(ctx: CanvasRenderingContext2D) {
    const g = this.game;
    const danger = clamp01((g.grid.maxRow() - (ROWS_ALLOWED - 4)) / 3);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (3 + danger * 6));
    const alpha = 0.3 + danger * 0.45 * pulse;
    ctx.strokeStyle = `rgba(255,${Math.round(130 - danger * 40)},${Math.round(150 - danger * 40)},${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 8]);
    ctx.lineDashOffset = this.reduce ? 0 : -this.time * 14;
    ctx.beginPath();
    ctx.moveTo(-4, LOSE_Y + 1);
    ctx.lineTo(W + 4, LOSE_Y + 1);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = `600 8px ${FONT}`;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = `rgba(255,150,165,${(0.45 + danger * 0.4).toFixed(3)})`;
    ctx.fillText('EVENT HORIZON', W - 2, LOSE_Y - 3);
    ctx.letterSpacing = '0px';
  }

  // ---- board -----------------------------------------------------------------

  private drawBoard(ctx: CanvasRenderingContext2D) {
    const g = this.game.grid;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -1, W + 20, LOSE_Y + 22);
    ctx.clip();

    const shift = this.boardShift;
    const float = this.reduce ? 0 : 1;
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      for (let c = 0; c < row.length; c++) {
        const color = row[c];
        if (color === null) continue;
        const p = g.center(r, c);
        let x = p.x;
        let y = p.y;
        let s = 1;
        const anim = this.landAnims.get(r * 16 + c);
        if (anim) {
          const k = easeOut(Math.min(1, anim.t / 0.07));
          x = lerp(anim.fromX, p.x, k);
          y = lerp(anim.fromY, p.y, k);
          s = 1 - 0.13 * Math.exp(-anim.t * 8) * Math.cos(anim.t * 30);
        }
        this.fx.displace(x, y, this.tmp);
        x += this.tmp.dx;
        y += this.tmp.dy + shift + float * Math.sin(this.time * 1.3 + r * 0.9 + c * 0.55) * 0.45;
        this.sprites.draw(ctx, color, x, y, s);
      }
    }

    // Twinkling highlights on random orbs.
    ctx.globalCompositeOperation = 'lighter';
    for (const t of this.twinkles) {
      if (g.get(t.r, t.c) === null) continue;
      const p = g.center(t.r, t.c);
      const k = t.t / 0.7;
      const a = Math.sin(k * Math.PI);
      const x = p.x - R * 0.4;
      const y = p.y - R * 0.46 + shift;
      const len = 3 + 6 * a;
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * a).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(0, shift);
    this.fx.drawPops(ctx, this.sprites);
    ctx.restore();
    ctx.restore();
  }

  // ---- aiming + launcher -----------------------------------------------------

  private getAim(): AimPath {
    const angle = this.game.angle;
    if (!this.aim || Math.abs(this.aim.angle - angle) > 0.0012 || this.aim.version !== this.version) {
      this.aim = { angle, version: this.version, path: tracePath(this.game.grid, angle, this.game.mode.guideBounces) };
    }
    return this.aim.path;
  }

  private drawGuide(ctx: CanvasRenderingContext2D) {
    const aim = this.getAim();
    const pts = aim.points;
    const rgb = ORB_STYLES[this.game.current].light;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (total < 1) return;

    const spacing = 15;
    let acc = this.reduce ? 0 : (this.time * 22) % spacing;
    let travelled = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      let pos = acc;
      while (pos <= len) {
        const d = travelled + pos;
        if (d > R * 2.1) {
          const k = d / total;
          ctx.fillStyle = `rgba(${rgb},${(0.85 - 0.6 * k).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(a.x + ux * pos, a.y + uy * pos, 2.7 - 1.4 * k, 0, Math.PI * 2);
          ctx.fill();
        }
        pos += spacing;
      }
      acc = pos - len;
      travelled += len;
    }

    if (aim.landed) {
      const end = pts[pts.length - 1];
      ctx.strokeStyle = `rgba(${rgb},0.45)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawLauncher(ctx: CanvasRenderingContext2D) {
    const g = this.game;
    const playing = g.phase !== 'won' && g.phase !== 'lost';

    ctx.save();
    ctx.translate(LAUNCH_X, LAUNCH_Y);

    // Docking rings.
    ctx.save();
    ctx.rotate(this.reduce ? 0 : this.time * 0.3);
    ctx.setLineDash([3, 9]);
    ctx.strokeStyle = 'rgba(150,180,255,0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, R * 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(180,205,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180,205,255,0.12)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // Emitter chevron pointing along the aim.
    if (playing) {
      ctx.save();
      ctx.rotate(-g.angle);
      ctx.fillStyle = `rgba(${ORB_STYLES[g.current].light},0.95)`;
      ctx.beginPath();
      ctx.moveTo(R * 2.95, 0);
      ctx.lineTo(R * 2.3, -6.5);
      ctx.lineTo(R * 2.5, 0);
      ctx.lineTo(R * 2.3, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Loaded orb (slides in from the "next" slot) and the next orb.
    const t = easeOut(this.loadT);
    if (g.phase === 'aiming' || g.phase === 'settling') {
      this.sprites.draw(ctx, g.current, lerp(NEXT_X, LAUNCH_X, t), lerp(NEXT_Y, LAUNCH_Y, t), lerp(0.72, 1, t));
    }
    if (playing) {
      const s = g.phase === 'flying' ? 0.72 : 0.72 * t;
      this.sprites.draw(ctx, g.next, NEXT_X, NEXT_Y, s);
      ctx.font = `600 8px ${FONT}`;
      ctx.letterSpacing = '2px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(200,215,255,0.55)';
      ctx.fillText('NEXT', NEXT_X, NEXT_Y + R * 0.72 + 7);
      ctx.letterSpacing = '0px';
    }

    this.drawPips(ctx);
  }

  /** Little lights counting misses until the ceiling descends. */
  private drawPips(ctx: CanvasRenderingContext2D) {
    const g = this.game;
    const n = g.missLimit;
    const spacing = 17;
    const startX = PIPS_X - ((n - 1) * spacing) / 2;
    const danger = g.misses >= n - 1 && g.phase !== 'won' && g.phase !== 'lost';
    const blink = danger ? 0.55 + 0.45 * Math.sin(this.time * 8) : 1;

    for (let i = 0; i < n; i++) {
      const x = startX + i * spacing;
      const lit = i < g.misses;
      if (lit) {
        const k = n > 1 ? i / (n - 1) : 1;
        const rgb = `${Math.round(lerp(110, 255, k))},${Math.round(lerp(225, 110, k))},${Math.round(lerp(255, 110, k))}`;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${rgb},${(0.35 * blink).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, PIPS_Y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(${rgb},1)`;
        ctx.beginPath();
        ctx.arc(x, PIPS_Y, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(x - 1.3, PIPS_Y - 1.4, 1.3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(170,190,255,0.4)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, PIPS_Y, 4.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.font = `600 8px ${FONT}`;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = danger ? 'rgba(255,150,160,0.75)' : 'rgba(200,215,255,0.55)';
    ctx.fillText('DESCENT', PIPS_X, PIPS_Y + 14);
    ctx.letterSpacing = '0px';
  }

  private drawShot(ctx: CanvasRenderingContext2D) {
    const s = this.game.shot;
    if (!s) return;
    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, R * 2);
    glow.addColorStop(0, `rgba(${ORB_STYLES[s.color].light},0.45)`);
    glow.addColorStop(1, `rgba(${ORB_STYLES[s.color].base},0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this.sprites.draw(ctx, s.color, s.x, s.y);
  }

  private drawPulse(ctx: CanvasRenderingContext2D) {
    const p = this.fx.pulse;
    if (p <= 0.01) return;
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 1.1);
    g.addColorStop(0, `rgba(190,205,255,${(p * 0.16).toFixed(3)})`);
    g.addColorStop(1, 'rgba(190,205,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(-W, -H, W * 3, H * 3);
    ctx.globalCompositeOperation = 'source-over';
  }
}
