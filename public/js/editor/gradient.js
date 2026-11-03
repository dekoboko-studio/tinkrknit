/**
 * Two-color gradients, dithered to stitches.
 *
 * A stitch takes one yarn or the other (CLAUDE.md 1.1), so a gradient on the
 * chart is never a blend: it is the share of stitches in the second color
 * rising from 0 to 1 along the drag. How those stitches are chosen is the
 * dither, and in knitting that choice is mostly about floats:
 *
 *   ordered   Bayer matrix. Regular, repeats every 4 or 8 stitches, keeps the
 *             runs of one color short through the middle. The default.
 *   diffusion Floyd-Steinberg. Smoothest to the eye, but organic clumps and
 *             no repeat, so floats vary and a tiled design shows its seam.
 *   noise     Hashed per stitch, so it is stable while you drag. Speckle.
 *   rows      Whole rows switch color first, a stripe ramp. No floats at all
 *             on a vertical gradient, which no other dither manages.
 *   none      A hard edge at the midpoint.
 *
 * Ordered, noise and rows read the stitch's tile coordinates, so the pattern
 * lines up across repeats when the tile is a multiple of the matrix size.
 */

export const DITHERS = [
  ['bayer4', 'Ordered'],
  ['bayer8', 'Ordered fine'],
  ['diffusion', 'Diffusion'],
  ['noise', 'Noise'],
  ['rows', 'Rows'],
  ['none', 'None'],
];

export const GRADIENT_SHAPES = [
  ['linear', 'Linear'],
  ['mirror', 'Mirrored'],
  ['radial', 'Radial'],
];

function bayer(n) {
  // Recursive construction: M(2n) = [4M, 4M+2; 4M+3, 4M+1].
  let m = [[0]];
  while (m.length < n) {
    const s = m.length;
    const next = Array.from({ length: s * 2 }, () => new Array(s * 2));
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + s] = v + 2;
        next[y + s][x] = v + 3;
        next[y + s][x + s] = v + 1;
      }
    }
    m = next;
  }
  return m.map((r) => r.map((v) => (v + 0.5) / (n * n)));
}

const BAYER = { bayer4: bayer(4), bayer8: bayer(8) };
const ROWS = [0.125, 0.625, 0.375, 0.875];

function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mod = (v, n) => ((v % n) + n) % n;

/**
 * End point with the angle snapped to 45 degrees, for Shift: the knitter's
 * gradients are mostly straight up the piece.
 */
export function snapEnd(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return b;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: Math.round(a.x + Math.cos(angle) * len), y: Math.round(a.y + Math.sin(angle) * len) };
}

/** 0 at the start, 1 at the end, for each shape. */
function rampAt(shape, a, d, len2, x, y) {
  const px = x - a.x;
  const py = y - a.y;
  let t;
  if (shape === 'radial') t = Math.sqrt((px * px + py * py) / len2);
  else {
    t = (px * d.x + py * d.y) / len2;
    if (shape === 'mirror') t = Math.abs(t);
  }
  return Math.min(1, Math.max(0, t));
}

/**
 * Cells of `area` ({x, y, w, h}) as [x, y, second] where `second` is true for
 * the stitches in the end color. Nothing for a zero-length drag.
 */
export function gradientCells({ start, end, area, shape = 'linear', dither = 'bayer4' }) {
  const d = { x: end.x - start.x, y: end.y - start.y };
  const len2 = d.x * d.x + d.y * d.y;
  if (!len2) return [];

  const out = [];
  if (dither === 'diffusion') {
    // Serpentine Floyd-Steinberg over the area only, so the result does not
    // depend on what lies outside it.
    const { w, h } = area;
    const err = new Float32Array((w + 2) * (h + 1));
    const at = (x, y) => (y * (w + 2)) + x + 1;
    for (let y = 0; y < h; y++) {
      const ltr = y % 2 === 0;
      for (let i = 0; i < w; i++) {
        const x = ltr ? i : w - 1 - i;
        const v = rampAt(shape, start, d, len2, area.x + x, area.y + y) + err[at(x, y)];
        const second = v >= 0.5;
        const e = v - (second ? 1 : 0);
        const f = ltr ? 1 : -1;
        err[at(x + f, y)] += (e * 7) / 16;
        err[at(x - f, y + 1)] += (e * 3) / 16;
        err[at(x, y + 1)] += (e * 5) / 16;
        err[at(x + f, y + 1)] += e / 16;
        out.push([area.x + x, area.y + y, second]);
      }
    }
    return out;
  }

  const matrix = BAYER[dither];
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const t = rampAt(shape, start, d, len2, x, y);
      let threshold = 0.5;
      if (matrix) threshold = matrix[mod(y, matrix.length)][mod(x, matrix.length)];
      else if (dither === 'noise') threshold = hash(x, y);
      else if (dither === 'rows') threshold = ROWS[mod(y, ROWS.length)];
      // Strict at the ends, so t = 0 is all start color and t = 1 all end.
      out.push([x, y, t >= 1 || (t > 0 && t > threshold)]);
    }
  }
  return out;
}
