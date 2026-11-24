interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  tw: number; // twinkle speed
  ph: number; // twinkle phase
}

interface Layer {
  stars: Star[];
  speed: number; // px/s drift
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

function renderNebula(hue: number, w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.ceil(w / 2));
  cv.height = Math.max(2, Math.ceil(h / 2));
  const ctx = cv.getContext('2d')!;
  const size = Math.max(cv.width, cv.height);
  ctx.globalCompositeOperation = 'lighter';
  // [x, y, radius, hue offset, alpha]: fixed layout so a hue change is a pure re-tint.
  const blobs = [
    [0.2, 0.22, 0.62, 0, 0.34],
    [0.82, 0.18, 0.5, 38, 0.28],
    [0.5, 0.56, 0.72, -28, 0.2],
    [0.12, 0.86, 0.52, 22, 0.26],
    [0.92, 0.78, 0.56, -48, 0.24],
  ];
  for (const [fx, fy, fr, dh, a] of blobs) {
    const x = fx * cv.width;
    const y = fy * cv.height;
    const g = ctx.createRadialGradient(x, y, 0, x, y, fr * size);
    g.addColorStop(0, `hsla(${hue + dh}, 85%, 52%, ${a})`);
    g.addColorStop(0.5, `hsla(${hue + dh}, 80%, 38%, ${a * 0.4})`);
    g.addColorStop(1, `hsla(${hue + dh}, 80%, 30%, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
  return cv;
}

/** Deep-space backdrop: tinted gradient, drifting nebula, parallax stars, the odd shooting star. */
export class Background {
  hue = 255;
  reduceMotion = false;

  private w = 0;
  private h = 0;
  private layers: Layer[] = [];
  private nebula: HTMLCanvasElement | null = null;
  private prevNebula: HTMLCanvasElement | null = null;
  private fade = 1;
  private nebulaHue = NaN;
  private shooter: ShootingStar | null = null;
  private nextShooter = 5;

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const area = (w * h) / (390 * 844);
    const make = (count: number, rMin: number, rMax: number, aMin: number, aMax: number, speed: number): Layer => ({
      speed,
      stars: Array.from({ length: Math.round(count * Math.max(0.6, area)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: rMin + Math.random() * (rMax - rMin),
        a: aMin + Math.random() * (aMax - aMin),
        tw: 0.6 + Math.random() * 2.2,
        ph: Math.random() * Math.PI * 2,
      })),
    });
    this.layers = [make(110, 0.4, 0.8, 0.25, 0.55, 3), make(55, 0.7, 1.1, 0.4, 0.75, 8), make(22, 1.1, 1.7, 0.6, 1, 16)];
    this.nebula = renderNebula(this.hue, w, h);
    this.prevNebula = null;
    this.nebulaHue = this.hue;
    this.fade = 1;
  }

  /** Re-tint the nebula (crossfades). Called when the player ranks up. */
  setHue(hue: number) {
    if (Math.abs(hue - this.hue) < 1 && !Number.isNaN(this.nebulaHue)) return;
    this.hue = hue;
    if (!this.w) return;
    this.prevNebula = this.nebula;
    this.nebula = renderNebula(hue, this.w, this.h);
    this.nebulaHue = hue;
    this.fade = this.prevNebula ? 0 : 1;
  }

  update(dt: number) {
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 2.2);
    if (this.reduceMotion) return;

    for (const layer of this.layers) {
      for (const s of layer.stars) {
        s.y += layer.speed * dt;
        if (s.y > this.h + 4) {
          s.y = -4;
          s.x = Math.random() * this.w;
        }
      }
    }

    this.nextShooter -= dt;
    if (!this.shooter && this.nextShooter <= 0) {
      const fromLeft = Math.random() < 0.5;
      this.shooter = {
        x: fromLeft ? -20 : this.w + 20,
        y: Math.random() * this.h * 0.5,
        vx: (fromLeft ? 1 : -1) * (380 + Math.random() * 220),
        vy: 160 + Math.random() * 120,
        life: 1.1,
      };
      this.nextShooter = 7 + Math.random() * 9;
    }
    if (this.shooter) {
      this.shooter.x += this.shooter.vx * dt;
      this.shooter.y += this.shooter.vy * dt;
      this.shooter.life -= dt;
      if (this.shooter.life <= 0) this.shooter = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const { w, h, hue } = this;
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, `hsl(${hue}, 55%, 4%)`);
    base.addColorStop(0.6, `hsl(${hue + 10}, 55%, 7%)`);
    base.addColorStop(1, `hsl(${hue + 30}, 50%, 10%)`);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Nebula, drifting very slowly (drawn 15% oversized so the edges never show).
    const dx = this.reduceMotion ? 0 : Math.sin(t * 0.03) * w * 0.03;
    const dy = this.reduceMotion ? 0 : Math.cos(t * 0.022) * h * 0.02;
    const drawNebula = (cv: HTMLCanvasElement | null, alpha: number) => {
      if (!cv || alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(cv, -w * 0.075 + dx, -h * 0.075 + dy, w * 1.15, h * 1.15);
    };
    drawNebula(this.prevNebula, 1 - this.fade);
    drawNebula(this.nebula, this.fade < 1 && this.prevNebula ? this.fade : 1);
    ctx.globalAlpha = 1;

    // Stars.
    for (const layer of this.layers) {
      for (const s of layer.stars) {
        const a = s.a * (0.72 + 0.28 * Math.sin(t * s.tw + s.ph));
        ctx.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`;
        ctx.fillRect(s.x, s.y, s.r * 1.6, s.r * 1.6);
      }
    }

    if (this.shooter) {
      const s = this.shooter;
      const a = Math.min(1, s.life * 1.4);
      const len = 0.12;
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * len, s.y - s.vy * len);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * len, s.y - s.vy * len);
      ctx.stroke();
    }
  }
}
