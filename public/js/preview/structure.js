/**
 * Structure preview: the fabric as the passes build it, not as the chart
 * draws it.
 *
 * A color chart cannot show why slip stitch draws up, why a tuck bulges or
 * which stitches mosaic pulls up from the row below. Those come from loops of
 * different lengths sharing one course of yarn, so this simulates exactly
 * that, cheaply:
 *
 *  - Every pass lays one course of yarn across the bed. Each needle on it has
 *    a height `y` (in rows).
 *  - A knit makes a new loop through the one below, and a loop wants to be
 *    one row long.
 *  - A slip makes nothing: the stitch below is stretched over the pass, and
 *    the course there is just a float, free to sit where its neighbors pull.
 *  - A tuck makes a loop that is not knitted but held with the old one, so it
 *    is tied hard to the old loop's height and knitted off with the next knit.
 *  - Neighboring needles on one course share yarn, so their heights pull
 *    toward each other.
 *
 * The heights are relaxed with Gauss-Seidel sweeps. It is a picture, not a
 * physics model: loop length, yarn tension and the stiffnesses are rough, and
 * the point is the shape - which stitches stretch, where the fabric gathers,
 * what the back looks like - rather than millimeters.
 *
 * The back is drawn mirrored, as it is seen when the fabric is turned over:
 * purl bumps, the floats behind slipped needles and Fair Isle's unused yarn,
 * and tuck loops lying across their stitch.
 */

import { stitchOf } from '../model/passes.js';
import { KNIT, TUCK, SLIP } from '../model/stitch.js';
import { colorAt, shade } from '../model/palette.js';

const LOOP = 1; // rest length of a knitted loop, in rows
const K_LOOP = 1;
const K_COURSE = 0.6;
const K_TUCK = 4;
const TUCK_RISE = 0.35; // how far above the held loop a tuck sits
const SWEEPS = 80;

/**
 * Relax a plan into course heights.
 * @returns {{ width, count, op, yarn, prev, y: Float32Array, top: number }}
 *   indexed [pass * width + x]; `prev` is the last pass that knitted that
 *   needle before this one, -1 for the cast-on.
 */
export function relax(plan) {
  const { width: w, passes } = plan;
  const n = passes.length;
  const size = w * n;
  const op = new Uint8Array(size);
  const yarn = new Int16Array(size);
  const other = new Int16Array(size).fill(-1); // Fair Isle: the yarn floating behind
  const prev = new Int32Array(size);
  const next = new Int32Array(size);
  const y = new Float32Array(size);

  const last = new Int32Array(w).fill(-1);
  const count = new Float32Array(w);
  for (let p = 0; p < n; p++) {
    const pass = passes[p];
    for (let x = 0; x < w; x++) {
      const i = p * w + x;
      const s = stitchOf(pass, x);
      op[i] = s.op;
      yarn[i] = s.yarn;
      if (pass.cam === 'fairisle' && pass.feeders.length > 1 && pass.feeders[0] !== pass.feeders[1]) {
        other[i] = s.yarn === pass.feeders[0] ? pass.feeders[1] : pass.feeders[0];
      }
      prev[i] = last[x];
      next[i] = -1;
      if (s.op === KNIT) {
        if (last[x] >= 0) next[last[x] * w + x] = p;
        last[x] = p;
        count[x] += LOOP;
        y[i] = count[x];
      } else {
        y[i] = count[x] + (s.op === TUCK ? TUCK_RISE : 0.5);
      }
    }
  }

  const heightOf = (p, x) => (p < 0 ? 0 : y[p * w + x]);

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let p = 0; p < n; p++) {
      const row = p * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let sum = 0;
        let weight = 0;
        if (op[i] === KNIT) {
          sum += K_LOOP * (heightOf(prev[i], x) + LOOP);
          weight += K_LOOP;
          if (next[i] >= 0) {
            sum += K_LOOP * (y[next[i] * w + x] - LOOP);
            weight += K_LOOP;
          }
        } else if (op[i] === TUCK) {
          sum += K_TUCK * (heightOf(prev[i], x) + TUCK_RISE);
          weight += K_TUCK;
        }
        if (x > 0) {
          sum += K_COURSE * y[i - 1];
          weight += K_COURSE;
        }
        if (x < w - 1) {
          sum += K_COURSE * y[i + 1];
          weight += K_COURSE;
        }
        if (weight) y[i] = sum / weight;
      }
    }
  }

  // A course cannot dip below the one before it at a needle that knitted:
  // the new loop is pulled through the old one, never under it.
  let top = 1;
  for (let i = 0; i < size; i++) {
    if (op[i] === KNIT && prev[i] >= 0) {
      const below = y[prev[i] * w + (i % w)];
      if (y[i] < below + 0.25) y[i] = below + 0.25;
    }
    if (y[i] > top) top = y[i];
  }
  return { width: w, count: n, op, yarn, other, prev, y, top: top + 0.15, ribber: passes.some((pass) => pass.ribber) };
}

/**
 * Draw a relaxed fabric. `geo` maps the fabric to the canvas:
 * { ox, oy, cw, ch, viewW, viewH, side: 'front'|'back', detail: boolean }.
 * Height 0 (the cast-on) is at the bottom, `oy + top * ch`.
 */
export function drawStructure(ctx, fabric, palette, geo) {
  const { width: w, count: n, op, yarn, other, prev, y, top } = fabric;
  const { ox, oy, cw, ch, viewW, viewH, side, detail } = geo;
  const back = side === 'back';
  const sy = (h) => oy + (top - h) * ch;
  const sx = (x) => ox + (back ? w - 1 - x : x) * cw;

  const tones = new Map();
  const tone = (index) => {
    let t = tones.get(index);
    if (!t) {
      const base = colorAt(palette, index);
      t = { base, dark: shade(base, -0.38), deep: shade(base, -0.55), light: shade(base, 0.22) };
      tones.set(index, t);
    }
    return t;
  };

  // Columns on screen, then the needles drawn in them (mirrored on the back).
  const cMin = Math.floor(-ox / cw) - 1;
  const cMax = Math.ceil((viewW - ox) / cw) + 1;
  const x0 = Math.max(0, back ? w - 1 - cMax : cMin);
  const x1 = Math.min(w, back ? w - cMin : cMax + 1);
  const visible = (a, b) => sy(b) < viewH + ch && sy(a) > -ch;

  ctx.lineCap = 'round';

  // Shadowed fabric behind everything, per stitch, so a stretched stitch is
  // a long dark cell rather than a hole.
  for (let p = 0; p < n; p++) {
    for (let x = x0; x < x1; x++) {
      const i = p * w + x;
      if (op[i] !== KNIT) continue;
      const below = prev[i] < 0 ? 0 : y[prev[i] * w + x];
      if (!visible(below, y[i])) continue;
      ctx.fillStyle = detail ? tone(yarn[i]).deep : tone(yarn[i]).base;
      ctx.fillRect(sx(x), sy(y[i]), cw + 0.6, (y[i] - below) * ch + 0.6);
    }
  }
  if (!detail) {
    if (back) drawFloats(true);
    return;
  }

  if (back) {
    drawBumps();
    drawFloats(false);
  } else {
    drawLegs();
  }

  /** Front: two legs per stitch, from its course down to the loop below. */
  function drawLegs() {
    const legWidth = cw * 0.38;
    const gap = cw * 0.13;
    for (let p = 0; p < n; p++) {
      for (let x = x0; x < x1; x++) {
        const i = p * w + x;
        if (op[i] !== KNIT) continue;
        const a = prev[i];
        const below = a < 0 ? 0 : y[a * w + x];
        if (!visible(below, y[i])) continue;

        // Tucks knitted off by this stitch lie behind it and show in the
        // opening between its legs, which is also pushed wider.
        let tucks = 0;
        for (let q = a + 1; q < p; q++) {
          const t = q * w + x;
          if (op[t] !== TUCK) continue;
          tucks++;
          ctx.strokeStyle = tone(yarn[t]).base;
          ctx.lineWidth = ch * 0.3;
          line(sx(x) + cw * 0.15, sy(y[t]) + ch * 0.1, sx(x) + cw * 0.85, sy(y[t]) + ch * 0.1);
        }

        const t = tone(yarn[i]);
        const cx = sx(x);
        const spread = Math.min(0.3, tucks * 0.12) * cw;
        const outL = cx + legWidth * 0.55 - spread;
        const outR = cx + cw - legWidth * 0.55 + spread;
        const inL = cx + cw / 2 - gap;
        const inR = cx + cw / 2 + gap;
        const topY = sy(y[i]) - ch * 0.08;
        const foot = sy(below) - ch * 0.22;
        const drop = ch * 0.07;

        ctx.strokeStyle = t.dark;
        ctx.lineWidth = legWidth * 1.15;
        line(outL, topY + drop, inL, foot + drop);
        line(outR, topY + drop, inR, foot + drop);
        ctx.strokeStyle = t.base;
        ctx.lineWidth = legWidth;
        line(outL, topY, inL, foot);
        line(outR, topY, inR, foot);
        ctx.strokeStyle = t.light;
        ctx.lineWidth = legWidth * 0.26;
        line(outL, topY + ch * 0.1, outL + (inL - outL) * 0.5, topY + (foot - topY) * 0.5);
        line(outR, topY + ch * 0.1, outR + (inR - outR) * 0.5, topY + (foot - topY) * 0.5);
      }
    }
  }

  /** Back: a purl bump where each loop goes through the one below. */
  function drawBumps() {
    for (let p = 0; p < n; p++) {
      for (let x = x0; x < x1; x++) {
        const i = p * w + x;
        if (op[i] !== KNIT) continue;
        const below = prev[i] < 0 ? 0 : y[prev[i] * w + x];
        if (!visible(below, y[i])) continue;
        const t = tone(yarn[i]);
        const cx = sx(x) + cw / 2;
        const cy = sy(below) - ch * 0.05;
        ctx.fillStyle = t.dark;
        ellipse(cx, cy + ch * 0.06, cw * 0.5, ch * 0.3);
        ctx.fillStyle = t.base;
        ellipse(cx, cy, cw * 0.46, ch * 0.26);
        ctx.fillStyle = t.light;
        ellipse(cx - cw * 0.08, cy - ch * 0.08, cw * 0.18, ch * 0.07);
      }
    }
  }

  /**
   * Floats behind slipped needles and Fair Isle's unused yarn, and tuck
   * loops. On a ribber-backed fabric the back is the ribber's knitting and
   * covers them, so they are left out.
   */
  function drawFloats(flat) {
    if (fabric.ribber) return;
    for (let p = 0; p < n; p++) {
      for (let x = x0; x < x1; x++) {
        const i = p * w + x;
        const h = y[i];
        if (!visible(h - 1, h)) continue;
        const left = sx(x);
        if (op[i] === SLIP || other[i] >= 0) {
          const t = tone(op[i] === SLIP ? yarn[i] : other[i]);
          ctx.strokeStyle = flat ? t.base : t.dark;
          ctx.lineWidth = Math.max(1, ch * 0.22);
          line(left - 0.5, sy(h) + ch * 0.35, left + cw + 0.5, sy(h) + ch * 0.35);
          if (!flat) {
            ctx.strokeStyle = t.base;
            ctx.lineWidth = Math.max(1, ch * 0.15);
            line(left - 0.5, sy(h) + ch * 0.33, left + cw + 0.5, sy(h) + ch * 0.33);
          }
        } else if (op[i] === TUCK) {
          const t = tone(yarn[i]);
          ctx.strokeStyle = t.base;
          ctx.lineWidth = Math.max(1, ch * 0.2);
          ctx.beginPath();
          ctx.ellipse(left + cw / 2, sy(h) + ch * 0.3, cw * 0.42, ch * 0.22, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function ellipse(cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
