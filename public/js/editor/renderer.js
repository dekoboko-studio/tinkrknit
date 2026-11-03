/**
 * Canvas renderer for the editing grid.
 *
 * Redraws everything on each frame. A tile is at most a few thousand cells, so
 * whole-canvas repaint is simpler and fast enough; do not add dirty-rect
 * tracking until it measurably matters (CLAUDE.md 5).
 *
 * The one feature here worth calling out is the ghost repeat: the tile's
 * neighbors are drawn dimmed around it, so you can see the seam while you
 * draw and design a motif that actually tiles.
 *
 * Rows are placed with `rowTop()`, never `y * cell`: on a stitch chart made
 * from colors a drawn row stays one square cell tall and its passes are thin
 * strips inside it (`vp.rows`, editor/viewport.js).
 */

import { colorAt } from '../model/palette.js';
import { tools } from '../core/registry.js';
import { dilate } from './shapes.js';
import { TUCK, SLIP, hasStitches } from '../model/stitch.js';
import { rowTop, rowSpan } from './viewport.js';

const RULER = 22;
const STITCH_INK = '#f4f1e8';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });

  // Everything is drawn in CSS pixels through a dpr transform, so any line that
  // wants to be crisp has to know the scale to snap itself to whole device
  // pixels. Kept here because `resize` is the only place it is measured.
  let dpr = 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = canvas;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function render(state, vp, extras = {}) {
    const { w, h } = resize();
    const { project, showGrid, gridMajor, showRulers, showPanelGhost } = state;
    const tile = project.tile;
    const cell = vp.cell;

    ctx.imageSmoothingEnabled = false;
    // The backdrop is the canvas's own CSS background (--bg-well), so the
    // stylesheet stays the one place the theme's colors live.
    ctx.fillStyle = getComputedStyle(canvas).backgroundColor;
    ctx.fillRect(0, 0, w, h);

    // --- ghost repeats ------------------------------------------------------
    if (showPanelGhost && cell >= 3) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      for (let ry = -1; ry <= 1; ry++) {
        for (let rx = -1; rx <= 1; rx++) {
          if (rx === 0 && ry === 0) continue;
          drawCells(tile, project.palette, vp, rx * tile.w, ry * tile.h);
        }
      }
      ctx.restore();
    }

    // --- the tile itself ----------------------------------------------------
    drawCells(tile, project.palette, vp, 0, 0);

    // --- the stitch layer ---------------------------------------------------
    // While it is being painted the colors are veiled so the marks read; on
    // the color layer they stay visible but quieter, so a Tuck & slip chart
    // never hides what it does.
    const onStitches = state.layer === 'stitches';
    if (onStitches) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#14161c';
      const top = Math.round(rowTop(vp, 0));
      ctx.fillRect(
        Math.round(vp.panX),
        top,
        Math.round(tile.w * cell),
        Math.round(rowTop(vp, tile.h)) - top
      );
      ctx.restore();
    }
    if ((onStitches || hasStitches(project)) && project.stitches && cell >= 4) {
      drawStitches(project.stitches, vp, onStitches ? 1 : 0.6);
    }

    // --- preview overlay (shape/line being dragged) -------------------------
    if (extras.preview?.length) {
      ctx.save();
      ctx.globalAlpha = onStitches ? 0.45 : 0.85;
      ctx.fillStyle = onStitches ? STITCH_INK : colorAt(project.palette, extras.previewIndex ?? 0);
      for (const [x, y] of extras.preview) {
        if (x < 0 || y < 0 || x >= tile.w || y >= tile.h) continue;
        const top = Math.round(rowTop(vp, y));
        ctx.fillRect(
          Math.round(vp.panX + x * cell),
          top,
          Math.ceil(cell),
          Math.max(1, Math.round(rowTop(vp, y + 1)) - top)
        );
      }
      ctx.restore();
    }

    if (showGrid && cell >= 5) drawGrid(tile, vp, gridMajor);

    drawTileBorder(tile, vp);

    if (extras.validation) drawRowFlags(extras.validation, project, vp);
    if (state.selection) drawSelection(state.selection, vp);
    if (extras.hover) drawHover(extras.hover, vp, tile, state);
    if (showRulers && cell >= 9) drawRulers(tile, vp, w, h, gridMajor);
  }

  // --- drawing pieces -------------------------------------------------------

  function drawCells(bm, palette, vp, offsetX, offsetY) {
    const cell = vp.cell;
    // Group runs of identical color into one fillRect: far fewer canvas calls
    // on the large flat areas typical of colorwork.
    for (let y = 0; y < bm.h; y++) {
      const py = Math.round(rowTop(vp, y + offsetY));
      const ph = Math.round(rowTop(vp, y + offsetY + 1)) - py;
      if (py + ph < 0 || py > canvas.clientHeight) continue;

      let runStart = 0;
      for (let x = 0; x <= bm.w; x++) {
        const here = x < bm.w ? bm.data[y * bm.w + x] : -1;
        const prev = bm.data[y * bm.w + runStart];
        if (x === bm.w || here !== prev) {
          const px = Math.round(vp.panX + (runStart + offsetX) * cell);
          const pw = Math.round(vp.panX + (x + offsetX) * cell) - px;
          ctx.fillStyle = colorAt(palette, prev);
          ctx.fillRect(px, py, pw, ph);
          runStart = x;
        }
      }
    }
  }

  /**
   * Tuck is a hollow ring (the held loop), slip a vertical bar (the stitch
   * pulled up through the row). Each is drawn light over a dark outline so it
   * reads on any yarn color.
   */
  function drawStitches(layer, vp, alpha) {
    const cell = vp.cell;
    if (layer.w * layer.h === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (let y = 0; y < layer.h; y++) {
      const y0 = rowTop(vp, y);
      const y1 = rowTop(vp, y + 1);
      if (y1 < 0 || y0 > canvas.clientHeight) continue;
      const cy = (y0 + y1) / 2;
      // A pass strip is shorter than a cell, and the mark shrinks to fit it.
      const s = Math.min(cell, y1 - y0);
      for (let x = 0; x < layer.w; x++) {
        const op = layer.data[y * layer.w + x];
        if (op !== TUCK && op !== SLIP) continue;
        const cx = vp.panX + (x + 0.5) * cell;
        for (const [style, width] of [['rgba(0,0,0,0.75)', Math.max(s < 6 ? 2 : 2.5, s * 0.2)], [STITCH_INK, Math.max(1, s * 0.1)]]) {
          ctx.strokeStyle = style;
          ctx.lineWidth = width;
          ctx.beginPath();
          if (op === TUCK) {
            ctx.arc(cx, cy, Math.max(1, s * 0.26), 0, Math.PI * 2);
          } else {
            const half = Math.max(0.5, s * 0.32);
            ctx.moveTo(cx, cy - half);
            ctx.lineTo(cx, cy + half);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /**
   * Snap a CSS-pixel coordinate so a line of `deviceWidth` device pixels covers
   * whole pixels instead of straddling two at partial alpha.
   *
   * Rounding in CSS pixels and adding the usual 0.5 only works at dpr 1. On a
   * scaled display it leaves fractional coverage that shifts with the zoom
   * level, which is why gridlines used to look dark at some zooms, washed out
   * at others, and doubled at others again.
   */
  function align(v, deviceWidth) {
    const d = v * dpr;
    const snapped = deviceWidth % 2 ? Math.floor(d) + 0.5 : Math.round(d);
    return snapped / dpr;
  }

  /*
   * Gridlines are a fixed mid-tone rather than white. White vanishes against
   * cream and ecru, which is most of a Fair Isle background, and a single
   * neutral keeps the grid reading the same over every yarn in the palette.
   */
  const GRID_MINOR = 'rgba(150,156,174,0.45)';
  const GRID_MAJOR = 'rgba(206,214,232,0.78)';
  // Between the passes of one drawn row: there, but quieter than a row line.
  const GRID_PASS = 'rgba(150,156,174,0.2)';

  function drawGrid(bm, vp, major) {
    const cell = vp.cell;
    const layout = vp.rows;
    const span = rowSpan(vp, bm.h);

    // 0 a pass line, 1 a row line, 2 a major row line. Rows count from the
    // cast-on edge so major lines land where a knitter would expect when
    // reading the chart bottom-up. On a converted chart a row line is a drawn
    // row's edge (a whole number in `top`) and the strips inside it get pass
    // lines, left out once they are too close together to tell apart.
    const kind = (y) => {
      const t = layout ? layout.top[y] : y;
      if (!Number.isInteger(t)) return 0;
      return (span - t) % major === 0 ? 2 : 1;
    };
    const passLines = layout && cell / Math.max(...layout.rows) >= 4;

    for (const level of [0, 1, 2]) {
      if (level === 0 && !passLines) continue;
      // Majors are two device pixels so they stay distinguishable from minors
      // without needing a brighter color, which would reintroduce the problem.
      const width = level === 2 ? 2 : 1;

      ctx.strokeStyle = [GRID_PASS, GRID_MINOR, GRID_MAJOR][level];
      ctx.lineWidth = width / dpr;
      ctx.beginPath();

      const top = align(rowTop(vp, 0), width);
      const bottom = align(rowTop(vp, bm.h), width);
      const left = align(vp.panX, width);
      const right = align(vp.panX + bm.w * cell, width);

      if (level > 0) {
        for (let x = 0; x <= bm.w; x++) {
          if ((level === 2) !== (x % major === 0)) continue;
          const px = align(vp.panX + x * cell, width);
          ctx.moveTo(px, top);
          ctx.lineTo(px, bottom);
        }
      }
      for (let y = 0; y <= bm.h; y++) {
        if (kind(y) !== level) continue;
        const py = align(rowTop(vp, y), width);
        ctx.moveTo(left, py);
        ctx.lineTo(right, py);
      }
      ctx.stroke();
    }
  }

  function drawTileBorder(bm, vp) {
    ctx.strokeStyle = 'rgba(120,200,255,0.9)';
    ctx.lineWidth = 2;
    const top = Math.round(rowTop(vp, 0));
    ctx.strokeRect(
      Math.round(vp.panX) - 1,
      top - 1,
      Math.round(bm.w * vp.cell) + 2,
      Math.round(rowTop(vp, bm.h)) - top + 2
    );
  }

  function drawSelection(sel, vp) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    const top = Math.round(rowTop(vp, sel.y));
    ctx.strokeRect(
      Math.round(vp.panX + sel.x * vp.cell) + 0.5,
      top + 0.5,
      Math.round(sel.w * vp.cell),
      Math.round(rowTop(vp, sel.y + sel.h)) - top
    );
    ctx.restore();
  }

  /**
   * Outline the cells the current tool would actually affect.
   *
   * Brush size is a dilation radius (`dilate` in editor/shapes.js), so the
   * footprint is a disc, not a square, and guessing at it would be wrong at
   * every size above 2. This calls the same function the tools call and traces
   * the silhouette of the result, so what is outlined is what gets painted.
   *
   * A tool with a footprint that is neither a disc nor a single cell says so
   * itself, with `footprint(state, cell)`. The text tool is the reason: a word
   * is far too big to place from a one-stitch cursor, and rasterizing it here
   * costs nothing because `rasterizeText` caches by its settings rather than by
   * position.
   */
  function drawHover(hover, vp, bm, state) {
    const cell = vp.cell;
    const tool = tools.get(state.tool);
    // A tool with a footprint of its own (stamp, text) can be placed with the
    // cursor off the tile, so a motif can hang over an edge; the clip below
    // still hides the cursor once none of it would land.
    const outside = hover.x < 0 || hover.y < 0 || hover.x >= bm.w || hover.y >= bm.h;
    if (outside && !tool?.footprint) return;

    const size = tool?.brush ? Math.max(1, Math.round(state.brushSize) || 1) : 1;

    const shape = tool?.footprint?.(state, hover)
      ?? (size > 1 ? dilate([[hover.x, hover.y]], size) : [[hover.x, hover.y]]);

    // Painting is clipped to the tile, so the cursor is clipped the same way.
    const cells = shape.filter(([x, y]) => x >= 0 && y >= 0 && x < bm.w && y < bm.h);
    if (!cells.length) return;

    const inside = new Set(cells.map(([x, y]) => x + ',' + y));
    const has = (x, y) => inside.has(x + ',' + y);

    ctx.save();

    // A wash over the footprint reads at a glance; the outline gives the exact
    // edge. Both are needed - at brush 9 the disc is hard to judge from an
    // outline alone, and a wash alone is too vague to place a stitch with.
    // A footprint cell that carries a palette index (the stamp's) is washed in
    // that color instead, so the motif shows where it will land before the click.
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    for (const [x, y, index] of cells) {
      if (index !== undefined) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = colorAt(state.project.palette, index);
      }
      const px = Math.round(vp.panX + x * cell);
      const py = Math.round(rowTop(vp, y));
      ctx.fillRect(
        px,
        py,
        Math.round(vp.panX + (x + 1) * cell) - px,
        Math.round(rowTop(vp, y + 1)) - py
      );
    }
    ctx.globalAlpha = 1;

    // The whole box a ghost covers, transparent background included, so the
    // extent of a sparse motif is clear and it can be lined up with others.
    const ghost = tool?.ghost?.(state, hover);
    if (ghost) {
      ctx.save();
      ctx.lineWidth = 1 / dpr;
      const x0 = align(vp.panX + ghost.x * cell, 1);
      const x1 = align(vp.panX + (ghost.x + ghost.bitmap.w) * cell, 1);
      const y0 = align(rowTop(vp, ghost.y), 1);
      const y1 = align(rowTop(vp, ghost.y + ghost.bitmap.h), 1);
      // Dark and light dashes in turn: one alone vanishes on cream or on navy.
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.lineDashOffset = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }

    // Only the edges with no neighbor in the set, which traces the silhouette
    // rather than every cell border.
    const trace = (width) => {
      ctx.lineWidth = width / dpr;
      ctx.beginPath();
      for (const [x, y] of cells) {
        const x0 = align(vp.panX + x * cell, width);
        const x1 = align(vp.panX + (x + 1) * cell, width);
        const y0 = align(rowTop(vp, y), width);
        const y1 = align(rowTop(vp, y + 1), width);

        if (!has(x, y - 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
        if (!has(x, y + 1)) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
        if (!has(x - 1, y)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
        if (!has(x + 1, y)) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
      }
      ctx.stroke();
    };

    // Dark underneath, light on top: visible over a cream yarn and a navy one.
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    trace(4);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    trace(2);

    ctx.restore();
  }

  /** Red/amber ticks in the left gutter for rows the validator flagged. */
  function drawRowFlags(validation, project, vp) {
    if (!validation.badTileRows?.size) return;
    const tooMany = new Set();
    for (const row of validation.rows) {
      const error = row.tooMany || row.issues?.some((i) => i.level === 'error');
      if (error && row.tileY >= 0) tooMany.add(row.tileY);
    }

    for (const tileY of validation.badTileRows) {
      ctx.fillStyle = tooMany.has(tileY) ? 'rgba(255,90,90,0.9)' : 'rgba(255,190,70,0.9)';
      const top = Math.round(rowTop(vp, tileY));
      ctx.fillRect(
        Math.round(vp.panX) - 7,
        top,
        4,
        Math.max(2, Math.round(rowTop(vp, tileY + 1)) - top)
      );
    }
  }

  function drawRulers(bm, vp, w, h, major) {
    const cell = vp.cell;
    ctx.save();
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(210,214,224,0.75)';
    ctx.textBaseline = 'middle';

    // Columns: needle order, counted from the left of the tile.
    ctx.textAlign = 'center';
    for (let x = 0; x < bm.w; x++) {
      if ((x + 1) % major !== 0) continue;
      const px = vp.panX + (x + 0.5) * cell;
      if (px < 0 || px > w) continue;
      ctx.fillText(String(x + 1), px, Math.max(8, vp.panY - 9));
    }

    // Rows: numbered from the cast-on edge upward, the way charts are read.
    // On a converted chart these are drawn rows, each one cell tall.
    ctx.textAlign = 'right';
    const span = rowSpan(vp, bm.h);
    for (let t = 0; t < span; t++) {
      const knitRow = span - t;
      if (knitRow % major !== 0) continue;
      const py = vp.panY + (t + 0.5) * cell;
      if (py < 0 || py > h) continue;
      ctx.fillText(String(knitRow), Math.max(RULER, vp.panX - 11), py);
    }
    ctx.restore();
  }

  return { render, resize, ctx };
}
