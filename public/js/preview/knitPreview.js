/**
 * Whole-panel preview with simulated stockinette stitches.
 *
 * Pixel-art previews lie about colorwork in two ways: stitches are wider than
 * they are tall, and the legs of a knit stitch blend adjacent colors in a way
 * that flat squares do not show. Both change how a motif reads, so this draws
 * real stitch legs at the project's real gauge aspect ratio.
 *
 * A stitch is two separate legs - `\ /` - not a joined V or U. In the fabric
 * each leg runs down and disappears behind the stitch below, so they never
 * meet at a point; joining them fills the middle and the preview turns into a
 * field of solid blobs where the colorwork reads as blocks again.
 *
 * Under the legs is a darkened flat pass in the same colors, so the openings
 * between and below the legs read as shadowed fabric rather than as holes
 * punched through to the canvas background.
 *
 * Rows are drawn bottom-up because later rows sit on top of earlier ones in
 * real fabric, and the overlap is most of what makes it read as knitting.
 *
 * Only Fair Isle is drawn this way. Every other technique knits a drawn row
 * as several passes, and a needle that tucks or slips in a pass makes no new
 * stitch there, so it is drawn from the simulation in preview/structure.js in
 * every mode: each stitch is stretched over the passes it was held for, and
 * the preview is as tall as the fabric rather than the chart. Drawing the
 * plan's chart a row per pass made Tuck & slip several times too tall, and
 * drawing the drawing made slip stitch and mosaic look like Fair Isle.
 * The 'structure' mode adds the back and the loop detail.
 */

import { panelIndexAt } from '../model/project.js';
import { colorAt, shade } from '../model/palette.js';
import { stitchAspect } from '../model/gauge.js';
import { compilePasses } from '../model/passes.js';
import { relax, drawStructure } from './structure.js';

/**
 * Everything a plan depends on, as a string. The preview redraws on every UI
 * change (zoom, hover, a panel opening); compiling and relaxing only when
 * this changes keeps that cheap.
 */
function planKey(project) {
  return JSON.stringify([
    project.technique,
    project.panel,
    project.repeat,
    project.stitch,
    project.validation?.maxSlip,
    project.palette.map((s) => s.color),
    project.tile.w,
    Array.from(project.tile.data).join(''),
    project.stitches ? Array.from(project.stitches.data).join('') : '',
  ]);
}

let cache = { key: null, plan: null, fabric: null };

/** The panel's pass plan, compiled once per change to the design. */
function planFor(project) {
  const key = planKey(project);
  if (cache.key !== key) cache = { key, plan: compilePasses(project, 'panel'), fabric: null };
  return cache.plan;
}

function fabricFor(project) {
  const plan = planFor(project);
  if (!cache.fabric) cache.fabric = relax(plan);
  return cache.fabric;
}

/** Below this stitch width the leg detail is invisible; draw flat cells instead. */
const V_THRESHOLD = 4;

export function createKnitPreview(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let frameQueued = false;
  let pending = null;
  let dpr = 1; // last frame's device pixel ratio; the guides snap against it

  // What the last frame actually drew. The full-window view needs this to clamp
  // panning and to report the zoom, and it is only knowable after a fit.
  let metrics = { fit: 1, cw: 1, ch: 1, originX: 0, originY: 0, viewW: 0, viewH: 0, rows: 0 };

  /**
   * @param {object} state
   * @param {{zoom?: number, panX?: number, panY?: number}} [view]
   *   Omitted, the panel is fitted to the canvas. The full-window view passes a
   *   zoom multiplier on that fit plus a pixel offset from center.
   */
  function render(state, view) {
    pending = { state, view };
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      const next = pending;
      pending = null;
      draw(next.state, next.view);
    });
  }

  function draw(state, view) {
    dpr = window.devicePixelRatio || 1;
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    if (viewW === 0 || viewH === 0) return;

    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The canvas's own CSS background: --bg-well docked, --bg-well-deep in the
    // full-window view. The stylesheet stays the one place colors live.
    ctx.fillStyle = getComputedStyle(canvas).backgroundColor;
    ctx.fillRect(0, 0, viewW, viewH);

    const { project, previewMode } = state;
    const { w: pw } = project.panel;
    const structure = previewMode === 'structure';
    // Only Fair Isle knits one row per drawn row; the rest are relaxed from
    // their passes, so the preview is as tall as the fabric they make.
    const relaxed = structure || (project.technique ?? 'fairisle') !== 'fairisle';
    const fabric = relaxed ? fabricFor(project) : null;
    // A relaxed view is as tall as the fabric, not the chart.
    const ph = relaxed ? fabric.top : project.panel.h;

    // Stitches are wider than tall; honor the gauge so the motif's real
    // proportions show. A round motif on a square grid knits up squashed.
    const aspect = stitchAspect(project.gauge);
    const pad = 10;
    const fit = Math.min((viewH - pad * 2) / ph, (viewW - pad * 2) / (pw * aspect));

    const ch = fit * (view?.zoom ?? 1);
    const cw = ch * aspect;

    const originX = (viewW - pw * cw) / 2 + (view?.panX ?? 0);
    const originY = (viewH - ph * ch) / 2 + (view?.panY ?? 0);

    metrics = { fit, cw, ch, originX, originY, viewW, viewH, rows: ph };

    if (relaxed) {
      drawStructure(ctx, fabric, project.palette, {
        ox: originX,
        oy: originY,
        cw,
        ch,
        viewW,
        viewH,
        side: structure ? state.previewSide : 'front',
        detail: previewMode !== 'chart' && cw >= V_THRESHOLD,
      });
      // Pass rows do not line up with fabric rows, so only the column repeats.
      if (!structure) drawRepeatMarks(state, originX, originY, cw, ch, ph, false);
      return;
    }

    // Fair Isle: the fabric is the drawing, one row per row.
    const indexAt = (x, y) => panelIndexAt(project, x, y);

    // Zoomed in, most of the panel is off-canvas. Drawing it anyway means tens
    // of thousands of wasted strokes per frame, which is felt while panning.
    const span = {
      x0: Math.max(0, Math.floor(-originX / cw)),
      x1: Math.min(pw, Math.ceil((viewW - originX) / cw) + 1),
      y0: Math.max(0, Math.floor(-originY / ch)),
      y1: Math.min(ph, Math.ceil((viewH - originY) / ch) + 1),
    };

    if (previewMode === 'chart' || cw < V_THRESHOLD) {
      drawFlat(state, indexAt, originX, originY, cw, ch, span);
    } else {
      drawKnit(state, indexAt, originX, originY, cw, ch, span);
    }

    drawRepeatMarks(state, originX, originY, cw, ch);
  }

  /**
   * Run-length flat cells. `tint` is passed to `shade`, so the same pass serves
   * both the chart view (0) and the shadow layer under the knit view.
   */
  function drawFlat(state, indexAt, ox, oy, cw, ch, span, tint = 0) {
    const { project } = state;

    for (let y = span.y0; y < span.y1; y++) {
      const py = oy + y * ch;
      let runStart = span.x0;
      let runIndex = indexAt(span.x0, y);

      for (let x = span.x0 + 1; x <= span.x1; x++) {
        const here = x < span.x1 ? indexAt(x, y) : -1;
        if (here === runIndex) continue;
        const runColor = colorAt(project.palette, runIndex);
        ctx.fillStyle = tint ? shade(runColor, tint) : runColor;
        ctx.fillRect(ox + runStart * cw, py, (x - runStart) * cw + 0.6, ch + 0.6);
        runStart = x;
        runIndex = here;
      }
    }
  }

  function drawKnit(state, indexAt, ox, oy, cw, ch, span) {
    const { project } = state;

    // Shadowed fabric behind the stitches, so the gap between two legs shows
    // dark yarn rather than the canvas.
    drawFlat(state, indexAt, ox, oy, cw, ch, span, -0.5);

    const legWidth = cw * 0.38;
    const gap = cw * 0.13; // half the opening between a stitch's two legs
    ctx.lineCap = 'round';

    // `shade` parses a hex string, and there are only a handful of distinct
    // colors on screen; caching by index keeps it off the per-cell path.
    const tones = new Map();
    const toneFor = (index) => {
      let tone = tones.get(index);
      if (!tone) {
        const base = colorAt(project.palette, index);
        tone = { base, dark: shade(base, -0.38), light: shade(base, 0.22) };
        tones.set(index, tone);
      }
      return tone;
    };

    // Bottom row first so upper rows overlap, as they do in the fabric.
    for (let y = span.y1 - 1; y >= span.y0; y--) {
      const cy = oy + y * ch;
      const top = cy - ch * 0.08; // runs up behind the row above
      const foot = cy + ch * 0.78;
      const drop = ch * 0.07; // how far the shadow sits below its leg

      for (let x = span.x0; x < span.x1; x++) {
        const tone = toneFor(indexAt(x, y));
        const cx = ox + x * cw;
        const center = cx + cw / 2;
        const outL = cx + legWidth * 0.55;
        const outR = cx + cw - legWidth * 0.55;
        const inL = center - gap;
        const inR = center + gap;

        // Each leg is its own stroke. One path through the middle would close
        // the gap at the bottom and put the V back.
        ctx.strokeStyle = tone.dark;
        ctx.lineWidth = legWidth * 1.15;
        line(outL, top + drop, inL, foot + drop);
        line(outR, top + drop, inR, foot + drop);

        ctx.strokeStyle = tone.base;
        ctx.lineWidth = legWidth;
        line(outL, top, inL, foot);
        line(outR, top, inR, foot);

        // A catch of light down the upper half of each leg reads as twist.
        ctx.strokeStyle = tone.light;
        ctx.lineWidth = legWidth * 0.26;
        line(outL, top + ch * 0.1, outL + (inL - outL) * 0.5, top + (foot - top) * 0.5);
        line(outR, top + ch * 0.1, outR + (inR - outR) * 0.5, top + (foot - top) * 0.5);
      }
    }
  }

  /** One segment, stroked with whatever style is current. */
  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  /**
   * Snap a coordinate to whole device pixels, as `editor/renderer.js` does.
   * `Math.round(v) + 0.5` is only right at dpr 1; at the 1.25 and 1.5 scalings
   * Windows ships with, a 1px line lands across two device columns and each
   * gets part of the coverage, which is most of why these guides washed out.
   */
  function align(v, deviceWidth) {
    const d = v * dpr;
    const snapped = deviceWidth % 2 ? Math.floor(d) + 0.5 : Math.round(d);
    return snapped / dpr;
  }

  /**
   * Dashed guides where the tile repeats, so seams are easy to judge.
   *
   * Drawn twice. A single light dash is the obvious thing and it is the wrong
   * thing here: the background of most Fair Isle is cream, and pale blue over
   * cream is invisible - the guide only showed over the dark yarns. The dark
   * casing underneath gives it an edge to read against on light fabric, and the
   * bright dash on top does the same on dark, so the line survives whatever the
   * palette turns out to be. Same reasoning as the gridline note in
   * `editor/renderer.js`: a guide must not depend on the yarn behind it.
   */
  const MARK_CASING = 'rgba(8,10,18,0.55)';
  const MARK_LINE = 'rgba(150,222,255,0.95)';
  const MARK_DASH = [5, 4];

  function drawRepeatMarks(state, ox, oy, cw, ch, rows = state.project.panel.h, rowMarks = true) {
    if (!state.showRepeatMarks) return;
    const { project } = state;
    const { tile, panel } = project;

    const verticals = [];
    const horizontals = [];

    if (project.repeat.horizontal) {
      const slack = panel.w - tile.w;
      const offset =
        project.repeat.alignment === 'left' ? 0
        : project.repeat.alignment === 'right' ? slack
        : Math.floor(slack / 2);
      for (let x = offset % tile.w; x <= panel.w; x += tile.w) verticals.push(x);
    }
    if (project.repeat.vertical && rowMarks) {
      for (let y = panel.h; y >= 0; y -= tile.h) horizontals.push(y);
    }
    if (!verticals.length && !horizontals.length) return;

    const top = oy;
    const bottom = oy + rows * ch;
    const left = ox;
    const right = ox + panel.w * cw;

    const pass = (width, dash) => {
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (const x of verticals) {
        const px = align(ox + x * cw, Math.round(width * dpr));
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
      }
      for (const y of horizontals) {
        const py = align(oy + y * ch, Math.round(width * dpr));
        ctx.moveTo(left, py);
        ctx.lineTo(right, py);
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'butt'; // drawKnit leaves it round, which fattens every dash
    ctx.strokeStyle = MARK_CASING;
    pass(3, []);
    ctx.strokeStyle = MARK_LINE;
    pass(1, MARK_DASH);
    ctx.restore();
  }

  return { render, metrics: () => metrics };
}
