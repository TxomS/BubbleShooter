import { H, POP_STAGGER, R, W } from '../game/config';
import type { Color } from '../game/grid';
import { comboMultiplier } from '../game/score';
import type { Orb } from '../game/state';
import { ORB_STYLES, type OrbSprites } from './sprites';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rgb: string;
  drag: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  rgb: string;
  width: number;
}

/** An orb that has been removed from the grid but is still on screen: it waits its turn, then bursts. */
interface PopAnim {
  x: number;
  y: number;
  color: Color;
  delay: number;
  t: number;
  combo: number;
}

interface Faller {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: Color;
  delay: number;
  trail: number[]; // flat x,y pairs, oldest first
}

interface Popup {
  x: number;
  y: number;
  text: string;
  rgb: string;
  size: number;
  delay: number;
  life: number;
  max: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
  amp: number;
}

const POP_LIFE = 0.24;
const GRAVITY = 1500;
const easeOut = (k: number) => 1 - (1 - k) ** 3;

export class Effects {
  reduce = false;
  /** 0..1 screen pulse, decays quickly. */
  pulse = 0;

  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private pops: PopAnim[] = [];
  private fallers: Faller[] = [];
  private popups: Popup[] = [];
  private ripples: Ripple[] = [];
  private lastPopCount = 0;

  clear() {
    this.sparks.length = 0;
    this.rings.length = 0;
    this.pops.length = 0;
    this.fallers.length = 0;
    this.popups.length = 0;
    this.ripples.length = 0;
    this.pulse = 0;
  }

  /** When a new row pushes the board down, things attached to the board move with it. */
  shiftBoardItems(dy: number) {
    for (const p of this.pops) p.y += dy;
    for (const r of this.ripples) r.y += dy;
  }

  addRipple(x: number, y: number, amp: number) {
    if (this.reduce) return;
    if (this.ripples.length > 8) this.ripples.shift();
    this.ripples.push({ x, y, age: 0, amp });
  }

  /** Where a board orb should be nudged to by active ripples (a gentle shockwave through the cluster). */
  displace(x: number, y: number, out: { dx: number; dy: number }) {
    out.dx = 0;
    out.dy = 0;
    for (const rp of this.ripples) {
      const ddx = x - rp.x;
      const ddy = y - rp.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < 1) continue;
      const wave = rp.amp * Math.exp(-dist / 110) * Math.exp(-rp.age * 5) * Math.sin(rp.age * 24 - dist * 0.085);
      out.dx += (ddx / dist) * wave;
      out.dy += (ddy / dist) * wave;
    }
  }

  addSparks(x: number, y: number, rgb: string, count: number, speed: number, life = 0.6) {
    const n = this.reduce ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: life * (0.6 + Math.random() * 0.6),
        max: life,
        size: 1.2 + Math.random() * 2.2,
        rgb,
        drag: 2.6,
      });
    }
  }

  /** A few dim sparks left behind a flying shot. */
  trail(x: number, y: number, color: Color) {
    if (this.reduce) return;
    this.sparks.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 20,
      vy: 20 + Math.random() * 30,
      life: 0.35,
      max: 0.35,
      size: 1.4 + Math.random() * 1.6,
      rgb: ORB_STYLES[color].light,
      drag: 2,
    });
  }

  onBounce(x: number, y: number, color: Color) {
    this.addSparks(x, y, ORB_STYLES[color].light, 6, 120, 0.35);
  }

  onPop(orbs: Orb[], combo: number, points: number, origin: { x: number; y: number }) {
    this.lastPopCount = orbs.length;
    orbs.forEach((o, i) => {
      this.pops.push({ x: o.x, y: o.y, color: o.color, delay: i * POP_STAGGER, t: 0, combo });
    });

    const rgb = ORB_STYLES[orbs[0]?.color ?? 0].light;
    this.popups.push({
      x: origin.x,
      y: origin.y - 26,
      text: `+${points}`,
      rgb: '255,255,255',
      size: 22,
      delay: Math.min(0.2, orbs.length * POP_STAGGER * 0.5),
      life: 1.1,
      max: 1.1,
    });
    if (combo >= 2) {
      this.popups.push({
        x: origin.x,
        y: origin.y - 48,
        text: `COMBO ×${comboMultiplier(combo)}`,
        rgb,
        size: 13,
        delay: 0.05,
        life: 1.1,
        max: 1.1,
      });
    }

    // Big clears get a proper supernova shockwave.
    if (orbs.length >= 6 || combo >= 3) {
      const power = Math.min(1, orbs.length / 10 + combo * 0.08);
      this.rings.push({ x: origin.x, y: origin.y, r0: R, r1: 120 + power * 120, life: 0.7, max: 0.7, rgb: rgb, width: 5 });
      if (!this.reduce) this.pulse = Math.min(1, this.pulse + 0.35 + power * 0.5);
    }
  }

  onDrop(orbs: Orb[], points: number) {
    const start = this.lastPopCount * POP_STAGGER + 0.08;
    orbs.forEach((o, i) => {
      this.fallers.push({
        x: o.x,
        y: o.y,
        vx: (Math.random() - 0.5) * 140,
        vy: -80 - Math.random() * 140,
        color: o.color,
        delay: start + i * 0.035,
        trail: [],
      });
    });
    if (orbs.length) {
      const top = orbs[0];
      this.popups.push({
        x: top.x,
        y: top.y + 6,
        text: `+${points}`,
        rgb: '255,214,110',
        size: 18 + Math.min(10, orbs.length),
        delay: start,
        life: 1.2,
        max: 1.2,
      });
      if (orbs.length >= 4 && !this.reduce) this.pulse = Math.min(1, this.pulse + 0.3);
    }
  }

  update(dt: number) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay <= 0) {
          this.burst(p);
          p.t = -p.delay;
        }
      } else {
        p.t += dt;
      }
      if (p.delay <= 0 && p.t >= POP_LIFE) this.pops.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
        continue;
      }
      const damp = Math.exp(-s.drag * dt);
      s.vx *= damp;
      s.vy = s.vy * damp + 40 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }

    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i];
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.trail.push(f.x, f.y);
      if (f.trail.length > 24) f.trail.splice(0, 2);
      if (f.y > H + 80) this.fallers.splice(i, 1);
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].age += dt;
      if (this.ripples[i].age > 1.2) this.ripples.splice(i, 1);
    }

    this.pulse = Math.max(0, this.pulse - dt * 2.4);
  }

  /** A single orb's supernova: sparks, a small shockwave ring and a nudge through the neighbours. */
  private burst(p: PopAnim) {
    const rgb = ORB_STYLES[p.color].light;
    this.addSparks(p.x, p.y, rgb, 9 + Math.min(8, p.combo * 2), 260);
    this.addSparks(p.x, p.y, ORB_STYLES[p.color].base, 5, 150, 0.8);
    this.rings.push({ x: p.x, y: p.y, r0: R * 0.7, r1: R * 2.7, life: 0.42, max: 0.42, rgb, width: 3 });
    this.addRipple(p.x, p.y, 1.6);
  }

  drawPops(ctx: CanvasRenderingContext2D, sprites: OrbSprites) {
    for (const p of this.pops) {
      if (p.delay > 0) {
        sprites.draw(ctx, p.color, p.x, p.y);
        continue;
      }
      const k = Math.min(1, p.t / POP_LIFE);
      sprites.draw(ctx, p.color, p.x, p.y, 1 + 0.5 * easeOut(k), 1 - k);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${(0.85 * (1 - k) * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R * (0.9 + 0.7 * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawRings(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      const radius = r.r0 + (r.r1 - r.r0) * easeOut(k);
      ctx.strokeStyle = `rgba(${r.rgb},${(0.9 * (1 - k) ** 1.5).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, r.width * (1 - k));
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawFallers(ctx: CanvasRenderingContext2D, sprites: OrbSprites) {
    for (const f of this.fallers) {
      if (f.delay > 0) {
        sprites.draw(ctx, f.color, f.x, f.y);
        continue;
      }
      const rgb = ORB_STYLES[f.color].base;
      const n = f.trail.length / 2;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 1; i < n; i++) {
        const k = i / n;
        ctx.strokeStyle = `rgba(${rgb},${(0.55 * k * k).toFixed(3)})`;
        ctx.lineWidth = R * 1.5 * k;
        ctx.beginPath();
        ctx.moveTo(f.trail[(i - 1) * 2], f.trail[(i - 1) * 2 + 1]);
        ctx.lineTo(f.trail[i * 2], f.trail[i * 2 + 1]);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      sprites.draw(ctx, f.color, f.x, f.y, 0.95);
    }
  }

  drawSparks(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.sparks) {
      const k = s.life / s.max;
      ctx.fillStyle = `rgba(${s.rgb},${Math.min(1, k * 1.3).toFixed(3)})`;
      const size = s.size * (0.4 + 0.6 * k);
      ctx.beginPath();
      ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawPopups(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      if (p.delay > 0) continue;
      const k = 1 - p.life / p.max;
      const alpha = k < 0.15 ? k / 0.15 : Math.min(1, (1 - k) * 2.2);
      const y = p.y - 34 * easeOut(k);
      const pop = k < 0.12 ? 0.7 + (k / 0.12) * 0.5 : 1.2 - Math.min(0.2, (k - 0.12) * 0.5);
      ctx.font = `700 ${Math.round(p.size * pop)}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      const x = Math.min(W - 54, Math.max(54, p.x)); // keep popups inside the board
      ctx.strokeStyle = `rgba(4,6,30,${(0.65 * alpha).toFixed(3)})`;
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = `rgba(${p.rgb},${alpha.toFixed(3)})`;
      ctx.fillText(p.text, x, y);
    }
  }
}
