/**
 * Shape rasterizers.
 *
 * Every shape is defined once as an `inside(u, v)` test in normalized box
 * coordinates, where u and v run -1..1 and v points *down* to match screen and
 * grid axes. A generic rasterizer turns that into cells, and derives the
 * outline version by edge detection, so a new shape is one small function and
 * one `registerShape` call (CLAUDE.md 3.3).
 *
 * Working from an implicit function rather than a polygon path is what keeps
 * shapes symmetric at tiny sizes - a 7x7 heart still reads as a heart.
 */

import { registerShape } from '../core/registry.js';

/** Bresenham. Used by the line tool and by outline dilation. */
export function linePoints(x0, y0, x1, y1) {
  const points = [];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;

  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

/** Grow a point set into a round brush of the given radius. */
export function dilate(points, radius) {
  if (radius <= 1) return points;
  const r = radius - 1;
  const seen = new Set();
  const out = [];
  for (const [x, y] of points) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r) continue;
        const key = `${x + dx},${y + dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([x + dx, y + dy]);
      }
    }
  }
  return out;
}

/**
 * Measure a shape's actual extent so it fills its bounding box.
 *
 * Implicit shapes are not all centered on the origin or bounded by the unit
 * square - a five-pointed star only reaches 0.81 downward, and the heart curve
 * is taller than it is wide. Without this, drawing a 15x15 star leaves two dead
 * rows at the bottom. Measuring once per shape keeps every shape honest without
 * hand-tuned magic numbers in each definition.
 */
const domainCache = new Map();

function fitDomain(inside, opts, cacheKey) {
  if (cacheKey && domainCache.has(cacheKey)) return domainCache.get(cacheKey);

  const STEPS = 160;
  const SPAN = 2; // sample well outside the unit box
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;

  for (let j = 0; j <= STEPS; j++) {
    const v = -SPAN + (2 * SPAN * j) / STEPS;
    for (let i = 0; i <= STEPS; i++) {
      const u = -SPAN + (2 * SPAN * i) / STEPS;
      if (!inside(u, v, opts)) continue;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
  }

  // Degenerate or everywhere-true shapes fall back to the unit box.
  const domain =
    u0 === Infinity || u1 - u0 < 1e-6 || v1 - v0 < 1e-6
      ? { u0: -1, u1: 1, v0: -1, v1: 1 }
      : { u0, u1, v0, v1 };

  if (cacheKey) domainCache.set(cacheKey, domain);
  return domain;
}

/** Turn an inside() test into cells within a w x h box. */
export function rasterizeInside(inside, w, h, { filled = true, stroke = 1, ...opts } = {}) {
  w = Math.max(1, w | 0);
  h = Math.max(1, h | 0);
  const mask = new Uint8Array(w * h);

  const { u0, u1, v0, v1 } = fitDomain(
    inside,
    opts,
    `${opts.__shapeId ?? ''}:${JSON.stringify(opts)}`
  );
  const du = u1 - u0;
  const dv = v1 - v0;

  for (let y = 0; y < h; y++) {
    const v = v0 + ((y + 0.5) / h) * dv;
    for (let x = 0; x < w; x++) {
      const u = u0 + ((x + 0.5) / w) * du;
      mask[y * w + x] = inside(u, v, opts) ? 1 : 0;
    }
  }

  const points = [];
  if (filled) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (mask[y * w + x]) points.push([x, y]);
    }
    return points;
  }

  // Outline: a filled cell touching empty space or the box edge.
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) {
        points.push([x, y]);
      }
    }
  }
  return dilate(points, stroke);
}

// --- geometry helpers -------------------------------------------------------

function pointInPolygon(u, v, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function starPolygon(points = 5, innerRatio = 0.42) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? innerRatio : 1;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// --- inside() tests ---------------------------------------------------------

export const INSIDE = {
  rect: () => true,

  ellipse: (u, v) => u * u + v * v <= 1,

  diamond: (u, v) => Math.abs(u) + Math.abs(v) <= 1,

  triangle: (u, v) => pointInPolygon(u, v, [[0, -1], [1, 1], [-1, 1]]),

  star: (u, v, { points = 5, innerRatio = 0.42 } = {}) =>
    pointInPolygon(u, v, starPolygon(points, innerRatio)),

  /**
   * The classic implicit heart, (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0, which spans
   * roughly x in -1.2..1.2 and y in -1.0..1.3. Scaled and nudged down so it
   * sits centered in the box with the point touching the bottom edge.
   */
  heart: (u, v) => {
    const x = u * 1.25;
    const y = -v * 1.22 + 0.12;
    const a = x * x + y * y - 1;
    return a * a * a - x * x * y * y * y <= 0;
  },

  /**
   * Six-fold snowflake: fold the angle into one wedge, then test a spine with
   * branches. Folding means perfect symmetry for free at any pixel size.
   */
  snowflake: (u, v, { arms = 6, thickness = 0.1 } = {}) => {
    const r = Math.hypot(u, v);
    if (r > 1) return false;
    if (r < 0.16) return true; // hub

    const wedge = (Math.PI * 2) / arms;
    let a = Math.atan2(v, u) % wedge;
    if (a < 0) a += wedge;
    a = Math.min(a, wedge - a); // fold to half a wedge

    const px = r * Math.cos(a);
    const py = r * Math.sin(a);

    if (py <= thickness && px <= 1) return true; // spine

    for (const base of [0.34, 0.56, 0.78]) {
      const len = 0.3 * (1.05 - base);
      const tipX = base + len * Math.cos(Math.PI / 3);
      const tipY = len * Math.sin(Math.PI / 3);
      if (distToSegment(px, py, base, 0, tipX, tipY) <= thickness * 0.85) return true;
    }
    return false;
  },

  plus: (u, v, { thickness = 0.34 } = {}) =>
    Math.abs(u) <= thickness || Math.abs(v) <= thickness,
};

// --- registration -----------------------------------------------------------

const BUILTIN = [
  { id: 'rect', label: 'Square / Rectangle', order: 10 },
  { id: 'ellipse', label: 'Circle / Oval', order: 20 },
  { id: 'triangle', label: 'Triangle', order: 30 },
  { id: 'diamond', label: 'Diamond', order: 40 },
  { id: 'star', label: 'Star', order: 50, defaults: { points: 5, innerRatio: 0.42 } },
  { id: 'heart', label: 'Heart', order: 60 },
  { id: 'snowflake', label: 'Snowflake', order: 70, defaults: { arms: 6, thickness: 0.1 } },
  { id: 'plus', label: 'Cross', order: 80 },
];

export function registerBuiltinShapes() {
  for (const { id, label, order, defaults } of BUILTIN) {
    registerShape({
      id,
      label,
      order,
      defaults: defaults ?? {},
      rasterize: (w, h, opts = {}) =>
        rasterizeInside(INSIDE[id], w, h, {
          __shapeId: id,
          ...(defaults ?? {}),
          ...opts,
        }),
    });
  }
}
