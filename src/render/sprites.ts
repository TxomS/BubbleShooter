import { D, R } from '../game/config';
import type { Color } from '../game/grid';

export type Pattern = 'rays' | 'craters' | 'continents' | 'facets' | 'bands' | 'ring';

export interface OrbStyle {
  name: string;
  base: string; // "r,g,b"
  light: string;
  dark: string;
  pattern: Pattern;
}

/**
 * Six celestial bodies. The colours follow the classic bubble-shooter palette
 * (yellow, red, green, cyan, blue, magenta) so it feels familiar, but each one
 * also has its own surface pattern so they can be told apart without colour.
 */
export const ORB_STYLES: OrbStyle[] = [
  { name: 'Sun', base: '255,194,51', light: '255,244,184', dark: '194,90,0', pattern: 'rays' },
  { name: 'Mars', base: '255,77,87', light: '255,179,168', dark: '140,15,38', pattern: 'craters' },
  { name: 'Terra', base: '61,220,132', light: '201,255,217', dark: '11,107,60', pattern: 'continents' },
  { name: 'Ice', base: '79,227,255', light: '226,252,255', dark: '10,111,153', pattern: 'facets' },
  { name: 'Gas giant', base: '84,112,255', light: '192,203,255', dark: '22,32,143', pattern: 'bands' },
  { name: 'Pulsar', base: '220,92,255', light: '249,208,255', dark: '108,26,152', pattern: 'ring' },
];

/** Logical size of one sprite cell: orb plus room for its glow and the pulsar's ring. */
export const SPRITE_L = D * 1.5;

const css = (rgb: string, a: number) => `rgba(${rgb},${a})`;

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function paintPattern(ctx: CanvasRenderingContext2D, s: OrbStyle) {
  switch (s.pattern) {
    case 'rays': {
      ctx.strokeStyle = css(s.light, 0.55);
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI * 2) / 10 + 0.2;
        const r2 = R * (i % 2 ? 0.55 : 0.78);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 0.24, Math.sin(a) * R * 0.24);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.4);
      g.addColorStop(0, 'rgba(255,255,235,0.85)');
      g.addColorStop(1, 'rgba(255,255,235,0)');
      ctx.fillStyle = g;
      disc(ctx, 0, 0, R * 0.4);
      ctx.fill();
      ctx.fillStyle = css(s.dark, 0.3);
      for (const [x, y, rx, ry] of [
        [-0.55, 0.35, 0.16, 0.1],
        [0.5, -0.1, 0.12, 0.08],
        [0.15, 0.62, 0.1, 0.07],
      ]) {
        ctx.beginPath();
        ctx.ellipse(x * R, y * R, rx * R, ry * R, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'craters': {
      for (const [x, y, r] of [
        [-0.38, 0.25, 0.24],
        [0.32, 0.12, 0.17],
        [0.02, -0.38, 0.14],
        [0.38, 0.55, 0.12],
        [-0.15, -0.05, 0.09],
        [-0.45, -0.38, 0.1],
      ]) {
        ctx.fillStyle = css(s.dark, 0.38);
        disc(ctx, x * R, y * R, r * R);
        ctx.fill();
        ctx.strokeStyle = css(s.light, 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x * R, y * R, r * R, Math.PI * 0.75, Math.PI * 1.75);
        ctx.stroke();
      }
      break;
    }
    case 'continents': {
      ctx.fillStyle = css(s.dark, 0.5);
      ctx.beginPath();
      ctx.moveTo(-0.62 * R, -0.12 * R);
      ctx.bezierCurveTo(-0.5 * R, -0.55 * R, -0.05 * R, -0.58 * R, 0.08 * R, -0.28 * R);
      ctx.bezierCurveTo(0.12 * R, 0.0, -0.3 * R, 0.1 * R, -0.35 * R, 0.32 * R);
      ctx.bezierCurveTo(-0.55 * R, 0.28 * R, -0.72 * R, 0.1 * R, -0.62 * R, -0.12 * R);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0.25 * R, 0.1 * R);
      ctx.bezierCurveTo(0.55 * R, -0.05 * R, 0.8 * R, 0.25 * R, 0.6 * R, 0.5 * R);
      ctx.bezierCurveTo(0.45 * R, 0.75 * R, 0.1 * R, 0.7 * R, 0.1 * R, 0.4 * R);
      ctx.bezierCurveTo(0.08 * R, 0.25 * R, 0.15 * R, 0.15 * R, 0.25 * R, 0.1 * R);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-0.1 * R, -0.05 * R, 0.82 * R, -0.5, 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.1 * R, 0.1 * R, 0.62 * R, 2.2, 2.9);
      ctx.stroke();
      break;
    }
    case 'facets': {
      ctx.fillStyle = css(s.light, 0.2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-0.55 * R, -0.62 * R);
      ctx.lineTo(0.4 * R, -0.58 * R);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css(s.dark, 0.2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0.4 * R, -0.58 * R);
      ctx.lineTo(0.8 * R, 0.1 * R);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = css(s.light, 0.6);
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (const [x1, y1, x2, y2] of [
        [-1, -0.2, 1, 0.35],
        [-0.4, -1, 0.3, 1],
        [-1, 0.5, 0.6, -0.9],
        [0, 0, 0.9, 0.7],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x1 * R, y1 * R);
        ctx.lineTo(x2 * R, y2 * R);
        ctx.stroke();
      }
      break;
    }
    case 'bands': {
      ctx.rotate(-0.25);
      for (const [y, h, light, a] of [
        [-0.7, 0.24, false, 0.3],
        [-0.34, 0.2, true, 0.28],
        [-0.06, 0.22, false, 0.32],
        [0.28, 0.2, true, 0.24],
        [0.6, 0.24, false, 0.3],
      ] as const) {
        ctx.fillStyle = css(light ? s.light : s.dark, a);
        ctx.fillRect(-R * 1.2, y * R, R * 2.4, h * R);
      }
      ctx.fillStyle = css(s.light, 0.5);
      ctx.beginPath();
      ctx.ellipse(0.3 * R, 0.12 * R, 0.24 * R, 0.14 * R, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = css(s.dark, 0.35);
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'ring':
      break; // the ring is drawn separately (half behind, half in front of the body)
  }
}

function ringHalf(ctx: CanvasRenderingContext2D, s: OrbStyle, front: boolean) {
  ctx.save();
  ctx.rotate(-0.38);
  ctx.strokeStyle = css(s.light, front ? 0.95 : 0.5);
  ctx.lineWidth = front ? 2.6 : 2.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 1.22, R * 0.36, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Paints one orb, centred at (cx, cy), at logical size. */
export function paintOrb(ctx: CanvasRenderingContext2D, s: OrbStyle, cx: number, cy: number) {
  ctx.save();
  ctx.translate(cx, cy);

  // Atmosphere glow.
  const glow = ctx.createRadialGradient(0, 0, R * 0.85, 0, 0, R * 1.42);
  glow.addColorStop(0, css(s.base, 0.34));
  glow.addColorStop(1, css(s.base, 0));
  ctx.fillStyle = glow;
  disc(ctx, 0, 0, R * 1.42);
  ctx.fill();

  if (s.pattern === 'ring') ringHalf(ctx, s, false);

  // Body, lit from the top-left.
  ctx.save();
  disc(ctx, 0, 0, R);
  ctx.clip();
  const body = ctx.createRadialGradient(-R * 0.36, -R * 0.42, R * 0.08, 0, 0, R * 1.08);
  body.addColorStop(0, css(s.light, 1));
  body.addColorStop(0.42, css(s.base, 1));
  body.addColorStop(1, css(s.dark, 1));
  ctx.fillStyle = body;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  ctx.save();
  paintPattern(ctx, s);
  ctx.restore();

  // Night side: a soft shadow creeping in from the bottom-right.
  const shade = ctx.createRadialGradient(-R * 0.5, -R * 0.55, R * 0.55, -R * 0.1, -R * 0.1, R * 1.3);
  shade.addColorStop(0, 'rgba(2,4,24,0)');
  shade.addColorStop(1, 'rgba(2,4,24,0.6)');
  ctx.fillStyle = shade;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();

  // Thin atmospheric rim.
  const rim = ctx.createLinearGradient(-R, -R, R, R);
  rim.addColorStop(0, 'rgba(255,255,255,0.75)');
  rim.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  rim.addColorStop(1, css(s.base, 0.55));
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.3;
  disc(ctx, 0, 0, R - 0.6);
  ctx.stroke();

  // Specular highlight.
  const spec = ctx.createRadialGradient(-R * 0.4, -R * 0.46, 0, -R * 0.4, -R * 0.46, R * 0.34);
  spec.addColorStop(0, 'rgba(255,255,255,0.95)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.ellipse(-R * 0.4, -R * 0.46, R * 0.3, R * 0.19, -0.6, 0, Math.PI * 2);
  ctx.fill();

  if (s.pattern === 'ring') ringHalf(ctx, s, true);
  ctx.restore();
}

/** Side of the square box that `paintCluster` draws into. */
export const CLUSTER_L = 56;

// [planet, x, y, diameter], back to front, in a CLUSTER_L x CLUSTER_L box.
const CLUSTER: readonly (readonly [number, number, number, number])[] = [
  [5, 20, 16, 21], // Pulsar, top left
  [3, 41, 17, 19], // Ice, top right
  [4, 45, 36, 21], // Gas giant, right
  [0, 11, 36, 19], // Sun, left
  [2, 31, 43, 20], // Terra, bottom
  [1, 25, 29, 25], // Mars, big and in front
];

/** A pile of all six planets overlapping, for an icon that means "everything" (the Endless card). */
export function paintCluster(ctx: CanvasRenderingContext2D) {
  for (const [planet, x, y, d] of CLUSTER) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(d / D, d / D);
    paintOrb(ctx, ORB_STYLES[planet], 0, 0);
    ctx.restore();
  }
}

/** Pre-rendered orb images at the current screen resolution. */
export class OrbSprites {
  private canvases: HTMLCanvasElement[] = [];
  private k = 0;

  /** (Re)build when the pixels-per-logical-unit changes enough to matter. */
  ensure(pxPerUnit: number) {
    const k = Math.round(pxPerUnit * 8) / 8;
    if (k === this.k && this.canvases.length) return;
    this.k = k;
    const size = Math.max(8, Math.ceil(SPRITE_L * k));
    this.canvases = ORB_STYLES.map((style) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d')!;
      ctx.scale(size / SPRITE_L, size / SPRITE_L);
      paintOrb(ctx, style, SPRITE_L / 2, SPRITE_L / 2);
      return cv;
    });
  }

  draw(ctx: CanvasRenderingContext2D, color: Color, x: number, y: number, scale = 1, alpha = 1) {
    const cv = this.canvases[color];
    if (!cv || scale <= 0) return;
    const s = SPRITE_L * scale;
    if (alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
    ctx.drawImage(cv, x - s / 2, y - s / 2, s, s);
    if (alpha < 1) ctx.globalAlpha = 1;
  }
}
