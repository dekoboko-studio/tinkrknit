/**
 * Editing tools.
 *
 * Each tool is a registered object, never a case in a switch (CLAUDE.md 3.3).
 * The canvas controller owns the pointer gesture and hands each tool a context:
 *
 *   ctx.cell        current cell under the pointer
 *   ctx.start       cell where the gesture began
 *   ctx.last        previous cell this gesture visited
 *   ctx.index       palette index to paint (primary, or secondary on right-drag)
 *   ctx.paint(pts)  write cells, applying mirror symmetry
 *   ctx.restore()   reset the tile to how it was when the gesture started
 *   ctx.state       the store state
 *
 * Tools mutate the tile directly and the canvas redraws, so a drag preview
 * shows the real colors rather than an approximation. The gesture is wrapped
 * in one undo step by the store.
 *
 * A tool may also declare `footprint(state, cell)`, returning the cells it
 * would paint from that cursor position. The hover cursor draws that instead of
 * guessing, which is the only way to place something as large as a word.
 *
 * A tool also declares which controls belong to it. `options` lists group ids
 * from the options-bar registry, and the bar above the grid shows exactly those
 * while the tool is selected - so a setting is on screen when it can do
 * something and gone when it cannot. A tool that lists none (the eyedropper,
 * shift) simply shows its `hint`.
 */

import { registerTool, shapes } from '../core/registry.js';
import {
  mdiPencil, mdiEraser, mdiVectorLine, mdiVectorSquare, mdiVectorCircleVariant,
  mdiStarOutline, mdiFormatColorFill, mdiFindReplace, mdiEyedropperVariant,
  mdiSelectionDrag, mdiCursorMove, mdiStamper, mdiFormatText, mdiGradientVertical,
} from '../icons.js';
import * as bitmap from '../model/bitmap.js';
import { linePoints, dilate } from './shapes.js';
import { rasterizeText } from './text.js';
import { gradientCells, snapEnd } from './gradient.js';
import { stitchAspect } from '../model/gauge.js';
import { setUI } from '../core/store.js';

/** Mirror a point set about the tile's center lines. */
export function applySymmetry(points, tile, mode) {
  if (!mode || mode === 'none') return points;

  const out = new Map();
  const add = (x, y) => out.set(`${x},${y}`, [x, y]);

  for (const [x, y] of points) {
    add(x, y);
    const mx = tile.w - 1 - x;
    const my = tile.h - 1 - y;
    if (mode === 'x' || mode === 'xy') add(mx, y);
    if (mode === 'y' || mode === 'xy') add(x, my);
    if (mode === 'xy') add(mx, my);
  }
  return [...out.values()];
}

function boxBetween(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

/** Constrain a drag to a square, for circles and squares held with Shift. */
function squareBox(a, b) {
  const size = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + 1;
  return {
    x: b.x < a.x ? a.x - size + 1 : a.x,
    y: b.y < a.y ? a.y - size + 1 : a.y,
    w: size,
    h: size,
  };
}

function shapePoints(ctx, shapeId) {
  const box = ctx.shiftKey ? squareBox(ctx.start, ctx.cell) : boxBetween(ctx.start, ctx.cell);
  const def = shapes.get(shapeId);
  if (!def) return [];
  const pts = def.rasterize(box.w, box.h, {
    filled: ctx.state.shapeFilled,
    stroke: ctx.state.brushSize,
    ...(ctx.state.shapeOptions ?? {}),
  });
  return pts.map(([x, y]) => [x + box.x, y + box.y]);
}

// --- tool definitions -------------------------------------------------------

const pencil = {
  id: 'pencil',
  label: 'Pencil',
  icon: mdiPencil,
  order: 10,
  brush: true,
  options: ['brush', 'mirror'],
  hint: 'Draw single stitches. Right-drag paints the base color.',
  onDown: (ctx) => ctx.paint(dilate([[ctx.cell.x, ctx.cell.y]], ctx.state.brushSize)),
  onMove: (ctx) => {
    // Join to the previous cell so a fast drag does not leave gaps.
    const pts = linePoints(ctx.last.x, ctx.last.y, ctx.cell.x, ctx.cell.y);
    ctx.paint(dilate(pts, ctx.state.brushSize));
  },
};

const eraser = {
  id: 'eraser',
  label: 'Eraser',
  icon: mdiEraser,
  order: 20,
  brush: true,
  options: ['brush', 'mirror'],
  hint: 'Paint back to the background color (slot 1).',
  forceIndex: 0,
  onDown: pencil.onDown,
  onMove: pencil.onMove,
};

const line = {
  id: 'line',
  label: 'Line',
  icon: mdiVectorLine,
  order: 30,
  brush: true,
  options: ['brush', 'mirror'],
  hint: 'Drag for a straight line. Thickness follows the brush size.',
  onMove: (ctx) => {
    ctx.restore();
    const pts = linePoints(ctx.start.x, ctx.start.y, ctx.cell.x, ctx.cell.y);
    ctx.paint(dilate(pts, ctx.state.brushSize));
  },
};

const rectangle = {
  id: 'rect',
  label: 'Rectangle',
  icon: mdiVectorSquare,
  order: 40,
  options: ['fill', 'mirror'],
  hint: 'Drag a box. Hold Shift for a square.',
  onMove: (ctx) => {
    ctx.restore();
    ctx.paint(shapePoints(ctx, 'rect'));
  },
};

const ellipse = {
  id: 'ellipse',
  label: 'Circle',
  icon: mdiVectorCircleVariant,
  order: 50,
  options: ['fill', 'mirror'],
  hint: 'Drag an oval. Hold Shift for a circle.',
  onMove: (ctx) => {
    ctx.restore();
    ctx.paint(shapePoints(ctx, 'ellipse'));
  },
};

/**
 * The two colors a gradient runs between: primary to secondary, or on the
 * stitch layer the selected op fading out to knit.
 */
export function gradientEnds(state) {
  return state.layer === 'stitches'
    ? { from: state.stitchOp, to: 0 }
    : { from: state.primary, to: state.secondary };
}

/** The selection clipped to the tile, else the whole tile. */
function gradientArea(state, tile) {
  const sel = state.selection;
  if (!sel) return { x: 0, y: 0, w: tile.w, h: tile.h };
  const x = Math.max(0, sel.x);
  const y = Math.max(0, sel.y);
  return {
    x, y,
    w: Math.max(0, Math.min(tile.w, sel.x + sel.w) - x),
    h: Math.max(0, Math.min(tile.h, sel.y + sel.h) - y),
  };
}

const gradient = {
  id: 'gradient',
  label: 'Gradient',
  icon: mdiGradientVertical,
  order: 72,
  options: ['gradient'],
  hint:
    'Drag from where the first color starts to where the second takes over. ' +
    'Fills the selection if there is one, else the tile. Shift snaps to 45 degrees.',
  onMove: (ctx) => {
    ctx.restore();
    const end = ctx.shiftKey ? snapEnd(ctx.start, ctx.cell) : ctx.cell;
    const { from, to } = gradientEnds(ctx.state);
    const cells = gradientCells({
      start: ctx.start,
      end,
      area: gradientArea(ctx.state, ctx.tile),
      shape: ctx.state.gradientShape,
      dither: ctx.state.gradientDither,
    });
    // Mirror does not apply: a gradient is laid over the whole area already.
    for (const [x, y, second] of cells) bitmap.set(ctx.tile, x, y, second ? to : from);
  },
};

/** Draws whichever shape is selected in the Shapes panel. */
const shape = {
  id: 'shape',
  label: 'Shape',
  icon: mdiStarOutline,
  order: 60,
  options: ['shape', 'fill', 'mirror'],
  hint: 'Drag to place the selected shape. Hold Shift to keep it square.',
  onMove: (ctx) => {
    ctx.restore();
    ctx.paint(shapePoints(ctx, ctx.state.shape));
  },
};

/**
 * Type in the options bar, click on the grid to set it down.
 *
 * The string is not stored in the document: once placed it is stitches like any
 * other, editable with the pencil, and there is no live text object to keep in
 * sync. That is the right trade for colorwork - the interesting work starts
 * *after* the letters land, tidying a diagonal that reads badly in stitches.
 *
 * Drag positions it: `onMove` restores and re-paints from the new cursor cell,
 * the same way the line tool previews, so the whole placement is one undo step.
 */
const text = {
  id: 'text',
  label: 'Text',
  icon: mdiFormatText,
  order: 65,
  options: ['text', 'mirror'],
  hint: 'Type in the bar above, then click the grid. Drag before letting go to place it.',
  footprint: (state, cell) => textPoints(state, cell),
  onDown: (ctx) => ctx.paint(textPoints(ctx.state, ctx.cell)),
  onMove: (ctx) => {
    ctx.restore();
    ctx.paint(textPoints(ctx.state, ctx.cell));
  },
};

/**
 * The rasterized block for the current settings. Exported because the options
 * bar reports its stitch count, and a word that has quietly come out 60 wide is
 * something you want to know before you place it, not after.
 */
export function textBlock(state) {
  return rasterizeText({
    text: state.text,
    family: state.textFont,
    rows: state.textSize,
    bold: state.textBold,
    italic: state.textItalic,
    spacing: state.textSpacing,
    // 1 means no correction: draw on the square grid, as an imported chart is.
    aspect: state.textGauge ? stitchAspect(state.project.gauge) : 1,
  });
}

/** Centered on the cursor, which is what makes dragging to position feel right. */
function textPoints(state, cell) {
  const { w, h, points } = textBlock(state);
  if (!points.length) return [];
  const ox = cell.x - (w >> 1);
  const oy = cell.y - (h >> 1);
  return points.map(([x, y]) => [x + ox, y + oy]);
}

const fill = {
  id: 'fill',
  label: 'Flood fill',
  icon: mdiFormatColorFill,
  order: 70,
  hint: 'Fill a connected area of one color.',
  onDown: (ctx) => {
    bitmap.floodFill(ctx.tile, ctx.cell.x, ctx.cell.y, ctx.index);
  },
};

const replace = {
  id: 'replace',
  label: 'Replace color',
  icon: mdiFindReplace,
  order: 75,
  hint: 'Swap every stitch of the clicked color for the active color.',
  onDown: (ctx) => {
    const from = bitmap.get(ctx.tile, ctx.cell.x, ctx.cell.y);
    if (from >= 0) bitmap.replaceIndex(ctx.tile, from, ctx.index);
  },
};

const eyedropper = {
  id: 'eyedropper',
  label: 'Pick color',
  icon: mdiEyedropperVariant,
  order: 80,
  hint: 'Set the active color from a stitch on the grid, or on the stitch layer, the active stitch.',
  noHistory: true,
  onDown: (ctx) => {
    const index = bitmap.get(ctx.tile, ctx.cell.x, ctx.cell.y);
    if (index < 0) return;
    if (ctx.state.layer === 'stitches') setUI({ stitchOp: index || ctx.state.stitchOp });
    else setUI({ primary: index });
  },
};

const select = {
  id: 'select',
  label: 'Select',
  icon: mdiSelectionDrag,
  order: 90,
  hint: 'Drag a box to select. Save it as a stamp, copy, cut or clear it from the bar above. Ctrl+C, Ctrl+X, Ctrl+V, Delete.',
  options: ['selection'],
  noHistory: true,
  onDown: (ctx) => setUI({ selection: { x: ctx.cell.x, y: ctx.cell.y, w: 1, h: 1 } }),
  onMove: (ctx) => setUI({ selection: boxBetween(ctx.start, ctx.cell) }),
};

/**
 * Torus shift. Essential for repeats: it lets you slide a motif across the tile
 * seam to check that the pattern still reads correctly when it wraps.
 */
const shift = {
  id: 'shift',
  label: 'Shift',
  icon: mdiCursorMove,
  order: 100,
  hint: 'Drag to slide the whole tile, wrapping around the edges.',
  onMove: (ctx) => {
    const dx = ctx.cell.x - ctx.start.x;
    const dy = ctx.cell.y - ctx.start.y;
    const base = ctx.base;
    const { w, h } = ctx.tile;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = ((x - dx) % w + w) % w;
        const sy = ((y - dy) % h + h) % h;
        ctx.tile.data[y * w + x] = base.data[sy * w + sx];
      }
    }
  },
};

/**
 * Placed like the text tool: the hover shows the stamp in its own colors where
 * it will land, and a drag before letting go moves it, so a placement is one
 * undo step wherever it ends up. R turns the stamp in hand (main.js).
 *
 * Once down it is stitches like any other, so there is no stamp object to pick
 * up again later; a drawn-over motif would be ambiguous to grab. The one
 * exception is the stamp just placed, which the arrow keys nudge while nothing
 * else has changed (`nudgeStamp`).
 */
const stamp = {
  id: 'stamp',
  label: 'Stamp',
  icon: mdiStamper,
  order: 110,
  options: ['stamp'],
  hint:
    'Click to place the stamp picked in the Stamps panel; drag before letting go to move it. ' +
    'R rotates it (Shift+R the other way), the arrow keys nudge the one just placed. ' +
    'Stamps are colors, so they place on the color layer only.',
  footprint: (state, cell) => {
    const at = stampPlacement(state, cell);
    if (!at) return [];
    const { w, h } = state.project.tile;
    const out = [];
    for (let y = 0; y < at.bitmap.h; y++) {
      for (let x = 0; x < at.bitmap.w; x++) {
        const v = at.bitmap.data[y * at.bitmap.w + x];
        if (v === at.transparentIndex) continue;
        out.push(at.wrap
          ? [bitmap.mod(at.x + x, w), bitmap.mod(at.y + y, h), v]
          : [at.x + x, at.y + y, v]);
      }
    }
    return out;
  },
  ghost: (state, cell) => stampPlacement(state, cell),
  onDown: (ctx) => placeStamp(ctx),
  onMove: (ctx) => {
    ctx.restore();
    placeStamp(ctx);
  },
  onUp: (ctx) => {
    lastStamp = stampPlacement(ctx.state, ctx.cell);
  },
};

/**
 * Where the stamp in hand lands with the cursor on `cell`: its transformed
 * bitmap, centered on the cursor. Null when there is nothing to place.
 */
export function stampPlacement(state, cell) {
  const active = state.activeStamp;
  if (!active || state.layer === 'stitches') return null;
  const { flipX, flipY, rotate } = state.stampTransform;
  const bm = bitmap.transform(active.bitmap, { flipX, flipY, rotate });
  return {
    bitmap: bm,
    x: cell.x - (bm.w >> 1),
    y: cell.y - (bm.h >> 1),
    transparentIndex: state.stampTransparent ? 0 : null,
    wrap: state.stampWrap,
  };
}

function placeStamp(ctx) {
  const at = stampPlacement(ctx.state, ctx.cell);
  if (!at) return;
  bitmap.blit(ctx.tile, at.bitmap, at.x, at.y, { transparentIndex: at.transparentIndex, wrap: at.wrap });
}

/**
 * The placement the last click made, for the arrow-key nudge. It keeps its own
 * bitmap, so turning the stamp in hand afterwards does not turn this one.
 */
let lastStamp = null;

/** Forget the nudgeable stamp, when anything else changes the document. */
export function forgetStamp() {
  lastStamp = null;
}

/**
 * Move the stamp just placed by (dx, dy): undo the placement and place it
 * again beside it, as one fresh undo step. Only while that placement is still
 * the last thing done, which main.js keeps true by calling `forgetStamp()` on
 * every other change. Returns false when there is nothing to nudge.
 *
 * `undo` and `place` are the store's, passed in so the tools stay free of
 * history: `place(fn)` commits `fn(tile)` as an undo step labeled stamp.
 */
export function nudgeStamp(dx, dy, { undo, place }) {
  if (!lastStamp) return false;
  const at = { ...lastStamp, x: lastStamp.x + dx, y: lastStamp.y + dy };
  undo();
  place((tile) => bitmap.blit(tile, at.bitmap, at.x, at.y, { transparentIndex: at.transparentIndex, wrap: at.wrap }));
  lastStamp = at;
  return true;
}

export const BUILTIN_TOOLS = [
  pencil, eraser, line, rectangle, ellipse, shape, text,
  fill, gradient, replace, eyedropper, select, shift, stamp,
];

export function registerBuiltinTools() {
  for (const tool of BUILTIN_TOOLS) registerTool(tool);
}
