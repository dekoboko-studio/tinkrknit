/**
 * The stitch layer: what each needle does, beside what color it shows.
 *
 * A second indexed grid the size of the tile, holding an operation per cell
 * instead of a palette index. It is edited with the same tools as the colors
 * (the active layer decides which grid a tool paints) and repeats across the
 * panel the same way.
 *
 * Only the operations the SK840 can make by needle selection on one bed are
 * here. Purl needs a garter carriage or a transfer by hand, so it is left out
 * on purpose (CLAUDE.md 7).
 *
 * Under the Tuck & slip technique each chart row is one carriage pass, and
 * its yarn is the row's color on the color layer - paint a row of the chart
 * to change the yarn for that pass. The cam is per pass, so a row can tuck or
 * slip but not both (model/validate.js reports a row that tries).
 */

import * as bitmap from './bitmap.js';

export const KNIT = 0;
export const TUCK = 1;
export const SLIP = 2;

export const OPS = [
  { id: KNIT, key: 'knit', label: 'Knit', title: 'An ordinary stitch. Right-drag paints knit on the stitch layer.' },
  { id: TUCK, key: 'tuck', label: 'Tuck', title: 'The needle takes the yarn but does not knit; the loop is held and knitted in later. Raises a bump and widens the stitch.' },
  { id: SLIP, key: 'slip', label: 'Slip', title: 'The needle is skipped; the yarn floats behind it and the stitch below is pulled up through this row.' },
];

export const opLabel = (op) => OPS[op]?.label ?? 'Knit';

/**
 * The project's stitch layer, made to match the tile. Anything that replaces
 * the tile (resize, crop, a document from before the layer existed) leaves
 * this to catch up, so the two can never disagree about size.
 */
export function stitchLayer(project) {
  const { tile } = project;
  const layer = project.stitches;
  if (!layer || layer.w !== tile.w || layer.h !== tile.h) {
    project.stitches = layer
      ? bitmap.resize(layer, tile.w, tile.h, { anchor: 'bottom-left' })
      : bitmap.createBitmap(tile.w, tile.h, KNIT);
  }
  return project.stitches;
}

/** True when any cell is something other than knit. */
export function hasStitches(project) {
  const layer = project.stitches;
  return Boolean(layer && layer.data.some((v) => v !== KNIT));
}
