/**
 * Drawn rows and carriage passes.
 *
 * A row of a color drawing is one row of the design. The one-color-per-pass
 * techniques knit it as several carriage passes, and "Stitch chart from
 * colors" writes those passes out one chart row each (ui/panels/stitches.js).
 * That chart is right for the machine and wrong to look at: a 160-row drawing
 * becomes 636 chart rows and the motif four times taller than it knits.
 *
 * So a converted chart keeps both counts. `project.source.rows` holds how many
 * passes each drawn row became, from the cast-on, and everything a person
 * reads - the editor's row heights, rulers, sizes, the knit screen - is
 * counted in drawn rows, with the pass shown beside it. The chart data and the
 * passes the machine is sent are unchanged.
 */

import { getTechnique, rowsPerDrawnRow } from './technique.js';

const layouts = new WeakMap();

/**
 * Where each tile row sits when drawn, in drawn rows from the top, or null
 * when tile rows are drawn rows (anything not converted, or a converted chart
 * resized since, whose pass counts no longer add up).
 *
 * @returns {null | {
 *   top: Float64Array,  h + 1 entries: top edge of tile row y; top[h] = span
 *   span: number,       drawn rows in the tile
 *   drawn: Int32Array,  drawn row of each tile row, 0 = cast-on
 *   pass: Int32Array,   which of its drawn row's passes, 0 = knitted first
 *   rows: number[],     passes per drawn row, from the cast-on
 * }}
 */
export function rowLayout(project) {
  const rows = project.source?.rows;
  const h = project.tile.h;
  if (!rows?.length || rows.reduce((a, b) => a + b, 0) !== h) return null;
  const cached = layouts.get(rows);
  if (cached && cached.top.length === h + 1) return cached;

  const n = rows.length;
  const top = new Float64Array(h + 1);
  const drawn = new Int32Array(h);
  const pass = new Int32Array(h);
  let end = h;
  for (let r = 0; r < n; r++) {
    const c = rows[r];
    const start = end - c;
    for (let k = 0; k < c; k++) {
      top[start + k] = n - 1 - r + k / c;
      drawn[start + k] = r;
      pass[start + k] = c - 1 - k; // the bottom strip is the first pass
    }
    end = start;
  }
  top[h] = n;
  const layout = { top, span: n, drawn, pass, rows };
  layouts.set(rows, layout);
  return layout;
}

/** "40" or "40, pass 3 of 4": tile row `y` (top-first) as a knitter counts it. */
export function rowName(project, y) {
  const layout = rowLayout(project);
  if (!layout) return String(project.tile.h - y);
  const r = layout.drawn[y];
  return `${r + 1}, pass ${layout.pass[y] + 1} of ${layout.rows[r]}`;
}

const sum = (list, n) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += list[i];
  return s;
};

/**
 * Passes in a panel `drawn` rows tall, repeating a tile whose drawn rows take
 * `rows` passes each. Repeats count from the cast-on, so the part repeat at
 * the top is the tile's bottom rows. Without vertical repeat the panel above
 * the tile is plain background, one pass a row.
 */
export function passesForRows(rows, vertical, drawn) {
  const n = rows.length;
  const tile = sum(rows, n);
  if (vertical) return Math.floor(drawn / n) * tile + sum(rows, drawn % n);
  return drawn > n ? tile + (drawn - n) : sum(rows, drawn);
}

/** The drawn row a panel pass row belongs to, both counted from the cast-on. */
function drawnOfPassRow(rows, vertical, q) {
  const n = rows.length;
  const tile = sum(rows, n);
  let base = 0;
  if (vertical) {
    base = Math.floor(q / tile) * n;
    q %= tile;
  } else if (q >= tile) {
    return n + (q - tile);
  }
  let r = 0;
  while (q >= rows[r]) q -= rows[r++];
  return base + r;
}

/** Drawn rows in the panel: its height, or for a converted chart, the rows its passes came from. */
export function panelRows(project) {
  const layout = rowLayout(project);
  if (!layout) return project.panel.h;
  return drawnOfPassRow(layout.rows, project.repeat.vertical, project.panel.h - 1) + 1;
}

/** Set a converted chart's panel by drawn rows: the passes that many rows take. */
export function panelPassesFor(project, drawn) {
  const layout = rowLayout(project);
  return layout ? passesForRows(layout.rows, project.repeat.vertical, drawn) : drawn;
}

/**
 * Regroup a converted chart's plan by drawn row, for the knit screen: each
 * pass's `row` becomes its drawn row and the chart shows each drawn row as it
 * stands after its last pass. It then reads "row 40 of 160, pass 3 of 4", as a
 * slip stitch job does, instead of "row 158 of 636". The passes themselves,
 * and so what the machine is sent, are untouched.
 * @param {'panel'|'tile'} scope which the plan was compiled for
 */
export function byDrawnRow(project, plan, scope) {
  const layout = rowLayout(project);
  if (!layout) return plan;
  const vertical = scope === 'tile' ? true : project.repeat.vertical;
  const drawnOf = (q) => (scope === 'tile' ? layout.drawn[plan.height - 1 - q] : drawnOfPassRow(layout.rows, vertical, q));
  const height = drawnOf(plan.height - 1) + 1;
  const { width } = plan;
  const chart = new Uint8Array(width * height);
  for (let q = 0; q < plan.height; q++) {
    // Later passes overwrite, so each drawn row keeps its last pass's look.
    const from = (plan.height - 1 - q) * width;
    chart.set(plan.chart.subarray(from, from + width), (height - 1 - drawnOf(q)) * width);
  }
  const passes = plan.passes.map((p) => ({ ...p, row: drawnOf(p.row) }));
  return { ...plan, height, chart, passes };
}

/**
 * True when rows are drawn rows of a technique that knits each one as
 * several passes, so a swatch's row gauge has to be counted in drawn rows.
 */
export function drawnGauge(project) {
  const from = project.source?.technique ?? project.technique;
  return Boolean(getTechnique(from).perColor);
}

/**
 * Drawn rows per 10cm. Measured on a swatch for these techniques
 * (`gauge.drawnRowsPer10`); until then, the plain row gauge divided by the
 * stitches each needle knits per drawn row - an overestimate of the length,
 * since slipped stitches pull the fabric up.
 */
export function rowGauge(project) {
  const { gauge } = project;
  if (!drawnGauge(project)) return gauge.rowsPer10;
  return gauge.drawnRowsPer10 || gauge.rowsPer10 / rowsPerDrawnRow(project);
}
