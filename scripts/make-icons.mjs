// Generates the PWA / home-screen icons (public/icons/*.png) with no dependencies:
// a tiny software rasteriser draws a ringed magenta planet and writes PNG files.
// Run with: npm run icons

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const over = (dst, src, a) => mix(dst, src, clamp01(a));

const STARS = [
  [0.14, 0.18, 0.012],
  [0.82, 0.12, 0.01],
  [0.9, 0.38, 0.008],
  [0.1, 0.62, 0.009],
  [0.2, 0.86, 0.012],
  [0.78, 0.84, 0.01],
  [0.55, 0.08, 0.007],
  [0.36, 0.93, 0.007],
];

/** Colour at (u, v) in 0..1. `scale` shrinks the artwork to leave a safe zone for maskable icons. */
function scene(u, v, scale, rounded) {
  const x = (u - 0.5) / scale;
  const y = (v - 0.5) / scale;

  // Rounded-square mask for regular icons.
  if (rounded) {
    const r = 0.18;
    const qx = Math.abs(u - 0.5) - (0.5 - r);
    const qy = Math.abs(v - 0.5) - (0.5 - r);
    if (qx > 0 && qy > 0 && Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  }

  // Deep-space background.
  const d = Math.hypot(u - 0.5, v - 0.42);
  let c = mix([30, 34, 96], [5, 6, 26], clamp01(d / 0.75));

  for (const [sx, sy, sr] of STARS) {
    const dd = Math.hypot(u - sx, v - sy);
    c = over(c, [255, 255, 255], 1 - dd / sr);
  }

  const R = 0.27;
  const dist = Math.hypot(x, y);

  // Soft halo.
  c = over(c, [220, 92, 255], (1 - clamp01((dist - R) / 0.3)) ** 2 * 0.28 * (dist > R ? 1 : 0));

  // Ring, in a frame tilted by -22 degrees.
  const ang = (-22 * Math.PI) / 180;
  const rx = x * Math.cos(ang) + y * Math.sin(ang);
  const ry = -x * Math.sin(ang) + y * Math.cos(ang);
  const ringR = Math.hypot(rx / (R * 1.62), ry / (R * 0.46));
  const ringBand = 1 - Math.abs(ringR - 1) / 0.075;
  const ringFront = ry > 0;
  const drawRing = (alpha) => (c = over(c, [249, 208, 255], ringBand * alpha));
  if (ringBand > 0 && !ringFront) drawRing(dist < R ? 0 : 0.6);

  // Planet body, lit from the top-left.
  if (dist < R) {
    const nx = x / R;
    const ny = y / R;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const diffuse = clamp01(nx * -0.5 + ny * -0.6 + nz * 0.62);
    let body = mix([108, 26, 152], [220, 92, 255], clamp01(diffuse * 1.2));
    body = mix(body, [249, 208, 255], clamp01((diffuse - 0.7) * 2.2));
    const spec = clamp01(1 - Math.hypot(nx + 0.38, ny + 0.45) / 0.3);
    body = over(body, [255, 255, 255], spec * 0.9);
    const edge = clamp01((dist - R * 0.94) / (R * 0.06));
    body = over(body, [255, 190, 255], edge * 0.35 * (nx < 0 && ny < 0 ? 1 : 0.3));
    c = body;
    // AA at the limb.
    c = over(c, [30, 34, 96], clamp01((dist - (R - 0.004)) / 0.004));
  }

  if (ringBand > 0 && ringFront) drawRing(0.95);
  return [...c, 255];
}

function render(size, { scale, rounded }) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // 3x3 supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = scene((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, scale, rounded);
          const al = (s[3] ?? 255) / 255;
          r += s[0] * al;
          g += s[1] * al;
          b += s[2] * al;
          a += al;
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      rgba[o] = a ? Math.round(r / a) : 0;
      rgba[o + 1] = a ? Math.round(g / a) : 0;
      rgba[o + 2] = a ? Math.round(b / a) : 0;
      rgba[o + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync('public/icons', { recursive: true });
const jobs = [
  ['icon-192.png', 192, { scale: 1, rounded: true }],
  ['icon-512.png', 512, { scale: 1, rounded: true }],
  ['icon-maskable-512.png', 512, { scale: 0.78, rounded: false }],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(`public/icons/${name}`, render(size, opts));
  console.log('wrote public/icons/' + name);
}
