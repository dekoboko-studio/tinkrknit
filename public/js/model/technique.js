/**
 * Knit technique: how the colorwork is made on the machine.
 *
 * The chart is the same indexed grid either way (CLAUDE.md 3.1). What changes
 * is which rules it is judged by and, later, how the knit screen sequences the
 * carriage:
 *
 *   fairisle  single bed, one pass per row, two feeders. Two colors per row and
 *             the unused one floats across the back (CLAUDE.md 1.2, 1.5).
 *   jacquard  double bed with the ribber, one pass per color per row, the
 *             back knitted on the ribber. No floats; colors per row are limited
 *             by the color changer and by how thick the backing gets, so the
 *             limit is a setting rather than a fact.
 *   slipcolor single bed, one feeder. Each row is knitted once per color in
 *             it: that color's needles knit, the rest slip, and the yarn floats
 *             behind them. Any number of colors per row, at the cost of passes.
 *   mosaic    single bed, one feeder, one color per row. A stitch of another
 *             color is made by slipping the stitch below it, so the color is
 *             pulled up from an earlier row. The rows' yarns and the slips are
 *             inferred from the color chart (model/passes.js).
 *   texture   single bed, one feeder, one pass per chart row, drawn on the
 *             stitch layer (model/stitch.js): knit, tuck or slip per needle.
 *             The row's color is its yarn. Single-color texture and tuck or
 *             slip colorwork both live here.
 *
 * A one-bit design knits as Fair Isle, jacquard, slip stitch or mosaic, so
 * this is a project setting you flip freely, not something the drawing
 * implies. The slip, tuck and jacquard cams are not yet verified on the bed
 * (CLAUDE.md 1.4).
 *
 *   floats      Fair Isle's float check applies
 *   perColor    knits one color per pass, `passesPerColor` passes each
 *   stitches    reads the stitch layer
 *   inferred    derives stitches from the colors (shown on the chart)
 */

export const TECHNIQUES = {
  fairisle: {
    id: 'fairisle',
    label: 'Fair Isle',
    title: 'Single bed, two colors per row, floats across the back',
    floats: true,
  },
  jacquard: {
    id: 'jacquard',
    label: 'Jacquard',
    title: 'Double bed with the ribber, one pass per color, no floats',
    floats: false,
    perColor: true,
  },
  slipcolor: {
    id: 'slipcolor',
    label: 'Slip stitch',
    title: 'Single bed, one feeder: each row is knitted once per color, the other needles slipping',
    floats: false,
    perColor: true,
  },
  mosaic: {
    id: 'mosaic',
    label: 'Mosaic',
    title: 'Single bed, one color per row; other colors come from stitches slipped up from the rows below',
    floats: false,
    perColor: true,
    inferred: true,
  },
  texture: {
    id: 'texture',
    label: 'Tuck & slip',
    title: 'Single bed, one pass per row, drawn on the stitch layer: knit, tuck or slip per needle',
    floats: false,
    stitches: true,
  },
};

/**
 * Passes per color, for the techniques that knit one color at a time. Two
 * brings the carriage back to the side it started, so every yarn stays on
 * one side of the bed and is there when it is next needed. One halves the
 * passes but leaves yarns on both sides (model/validate.js counts the cost).
 */
export const DEFAULT_PASSES_PER_COLOR = 2;
export const passesPerColor = (project) => (project.stitch?.passesPerColor === 1 ? 1 : 2);

export const DEFAULT_TECHNIQUE = 'fairisle';
export const DEFAULT_JACQUARD_COLORS = 4;

/**
 * How the ribber knits the back of a jacquard. It changes the fabric, not the
 * chart: the front is the same stitches whichever is used. So the project
 * saves a preferred backing and the knit screen may override it per job,
 * like Swap feeders - it is decided at the machine as often as at the desk.
 */
export const JACQUARD_BACKINGS = {
  birdseye: {
    id: 'birdseye',
    label: 'Birdseye',
    title: 'Colors alternate on the back needle by needle. Firm, flat, the usual choice.',
  },
  striped: {
    id: 'striped',
    label: 'Striped',
    title: 'Each color knits a full row on the back. Thicker and warmer; the back shows stripes.',
  },
  ladder: {
    id: 'ladder',
    label: 'Ladder',
    title: 'Every other ribber needle out of work. Lighter, but floats short ladders across the back.',
  },
};

export const DEFAULT_BACKING = 'birdseye';

export const getBacking = (id) => JACQUARD_BACKINGS[id] ?? JACQUARD_BACKINGS[DEFAULT_BACKING];
export const backingList = () => Object.values(JACQUARD_BACKINGS);

export function getTechnique(id) {
  return TECHNIQUES[id] ?? TECHNIQUES[DEFAULT_TECHNIQUE];
}

export const techniqueList = () => Object.values(TECHNIQUES);

/** The most colors a row may use under the project's technique. */
export function colorsPerRow(project) {
  const id = getTechnique(project.technique).id;
  if (id === 'jacquard') return project.validation?.jacquardColors ?? DEFAULT_JACQUARD_COLORS;
  // Slip stitch takes any number at a pass each; mosaic and texture have a
  // yarn per row and their own checks (model/validate.js).
  if (id !== 'fairisle') return Infinity;
  // Single-bed Fair Isle is two feeders on every machine (CLAUDE.md 1.2).
  return 2;
}
