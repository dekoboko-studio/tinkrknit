/**
 * Zoom and pan for the editing canvas.
 *
 * Cells are square on the *editing* grid. Knit stitches are not square, but
 * squashing the edit grid makes counting stitches harder; the realistic
 * proportions live in the knit preview instead (preview/knitPreview.js).
 */

export const MIN_CELL = 2;
export const MAX_CELL = 64;

export function createViewport() {
  return { cell: 16, panX: 0, panY: 0, rows: null };
}

/*
 * `vp.rows` is the tile's row layout (model/rows.js) or null. With one, a
 * converted stitch chart keeps square drawn rows and each is cut into one
 * strip per pass, so tile row y is not y cells down. Rows repeat with the
 * tile above and below it, for the ghost repeats.
 */

/** Screen y of the top edge of tile row `y` (any integer, ghosts included). */
export function rowTop(vp, y) {
  const layout = vp.rows;
  if (!layout) return vp.panY + y * vp.cell;
  const h = layout.top.length - 1;
  const rep = Math.floor(y / h);
  return vp.panY + (rep * layout.span + layout.top[y - rep * h]) * vp.cell;
}

/** Height on screen of tile row `y`. */
export function rowHeight(vp, y) {
  return rowTop(vp, y + 1) - rowTop(vp, y);
}

/** Rows of the tile in square cells: its height, or its drawn rows. */
export function rowSpan(vp, h) {
  return vp.rows ? vp.rows.span : h;
}

function rowAt(vp, py) {
  const unit = (py - vp.panY) / vp.cell;
  const layout = vp.rows;
  if (!layout) return Math.floor(unit);
  const { top, span } = layout;
  const h = top.length - 1;
  const rep = Math.floor(unit / span);
  const u = unit - rep * span;
  let lo = 0;
  let hi = h - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (top[mid] <= u) lo = mid;
    else hi = mid - 1;
  }
  return rep * h + lo;
}

export function screenToCell(vp, px, py) {
  return {
    x: Math.floor((px - vp.panX) / vp.cell),
    y: rowAt(vp, py),
  };
}

export function cellToScreen(vp, cx, cy) {
  return { x: cx * vp.cell + vp.panX, y: rowTop(vp, cy) };
}

/** Zoom about a fixed screen point so the cell under the cursor stays put. */
export function zoomAt(vp, px, py, factor) {
  const next = clampCell(vp.cell * factor);
  if (next === vp.cell) return false;

  const scale = next / vp.cell;
  vp.panX = px - (px - vp.panX) * scale;
  vp.panY = py - (py - vp.panY) * scale;
  vp.cell = next;
  return true;
}

export function setZoom(vp, cell, centerX, centerY) {
  const next = clampCell(cell);
  const scale = next / vp.cell;
  vp.panX = centerX - (centerX - vp.panX) * scale;
  vp.panY = centerY - (centerY - vp.panY) * scale;
  vp.cell = next;
}

function clampCell(value) {
  // Snap to whole pixels above 4 so gridlines stay crisp instead of shimmering.
  const v = Math.max(MIN_CELL, Math.min(MAX_CELL, value));
  return v >= 4 ? Math.round(v) : Number(v.toFixed(2));
}

/** Fit a grid of w x h cells into the viewport with a little breathing room. */
export function fit(vp, gridW, gridH, viewW, viewH, padding = 24) {
  const cell = clampCell(
    Math.min((viewW - padding * 2) / gridW, (viewH - padding * 2) / gridH)
  );
  vp.cell = cell;
  vp.panX = Math.round((viewW - gridW * cell) / 2);
  vp.panY = Math.round((viewH - gridH * cell) / 2);
  return vp;
}

export function pan(vp, dx, dy) {
  vp.panX += dx;
  vp.panY += dy;
}
