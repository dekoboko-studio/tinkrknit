/**
 * A knit job: the panel as the machine will knit it.
 *
 * "Knit" in the designer freezes the panel into a job and opens the knit
 * screen on it. It is a snapshot on purpose: editing the design mid-piece must
 * not change the rows the carriage is about to knit. Press Knit again after
 * an edit to offer the new version; the knit screen asks before it replaces a
 * job that is under way.
 *
 * The job and the knitting position are kept in localStorage, so a reload
 * resumes on the row it left.
 *
 * A job carries the whole panel and, beside it, one tile. The knit screen
 * chooses which to knit: the panel exactly as designed, or the tile repeated
 * across whatever span the needle markers give it (`knitGrid`).
 *
 * What the carriage does is the job's pass plan (model/passes.js): `passes`
 * in knitting order, each saying which chart row it belongs to. The knit
 * screen walks passes, never rows, so a technique that needs two or three
 * passes per row is just a longer list. `chart` is what the knitted piece
 * shows, top row first as everywhere (CLAUDE.md 4); it is for display only.
 * Pass and row indices here both count from the cast-on edge.
 */

import { compilePasses, rowStarts } from '../model/passes.js';
import { byDrawnRow } from '../model/rows.js';
import { colorAt } from '../model/palette.js';
import { serialize, deserialize } from '../model/project.js';
import { validateProject } from '../model/validate.js';
import { colorTechniques, colorTechniqueOf, isColorTechnique, isStitchChart } from '../model/technique.js';
import { MAX_NEEDLES } from './protocol.js';

const JOB_KEY = 'knit-designer:knit-job';
const SESSION_KEY = 'knit-designer:knit-session';

// --- building ---------------------------------------------------------------

/** Why this project cannot go to the machine, or null if it can. */
export function jobBlocker(project) {
  if (project.panel.w > MAX_NEEDLES) {
    return `The panel is ${project.panel.w} stitches; the controller drives at most ${MAX_NEEDLES} needles.`;
  }
  return null;
}

/** The knit-screen half of a pass plan, as plain JSON for localStorage. */
function planFields(plan) {
  return {
    width: plan.width,
    height: plan.height,
    /** Palette index per stitch as knitted, row-major, top row first. */
    chart: Array.from(plan.chart),
    /** Cast-on first. bits: 1 = needle selected, chart left to right. */
    passes: plan.passes.map((p) => ({
      row: p.row,
      cam: p.cam,
      feeders: [...p.feeders],
      bits: Array.from(p.bits),
      substituted: p.substituted,
      ...(p.ribber ? { ribber: true } : {}),
      ...(p.travel ? { travel: true } : {}),
      ...(p.wrap ? { wrap: true } : {}),
    })),
  };
}

/**
 * The technique a project knits as: a stitch chart only as Tuck & slip, a
 * color chart as `as` when that is a color technique (the knit screen's
 * choice), else as the designer checks it.
 */
const knitTechnique = (project, as) =>
  isStitchChart(project) ? project.technique : isColorTechnique(as) ? as : colorTechniqueOf(project);

/**
 * Freeze the project into a job, knitted as `as` (see knitTechnique). The
 * design rides along as `design`, so the knit screen can knit the same
 * snapshot as another technique without going back to the designer.
 */
export function buildJob(project, as) {
  const technique = knitTechnique(project, as);
  const knitted = { ...project, technique };
  // A converted stitch chart is knitted by drawn row (model/rows.js).
  const plan = byDrawnRow(knitted, compilePasses(knitted, 'panel'), 'panel');
  return {
    version: 3,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: project.name,
    /**
     * How this job knits (model/technique.js). The passes already say what
     * each carriage pass does; this is for the screen's labels. Jobs saved
     * before this field existed are Fair Isle.
     */
    technique,
    /** A stitch chart knits only as Tuck & slip; a color chart as any color technique. */
    stitchChart: isStitchChart(project),
    /** What the designer checks a color chart as, for the knit screen to mention. */
    checkedAs: colorTechniqueOf(project),
    /** The design as sent (model/project.js serialize). Jobs before this cannot change technique. */
    design: serialize(project),
    sentAt: new Date().toISOString(),
    ...planFields(plan),
    /** One repeat, same layout as the panel fields above. */
    tile: planFields(byDrawnRow(knitted, compilePasses(knitted, 'tile'), 'tile')),
    yarns: project.palette.map((slot, index) => ({
      hex: colorAt(project.palette, index),
      name: slot.name || `Color ${index + 1}`,
    })),
    substitutions: plan.substitutions.length,
  };
}

/** True when the job can be knitted as another color technique. */
export const canChangeTechnique = (job) => Boolean(job?.design) && !job.stitchChart;

/**
 * The same job, from the same design snapshot, knitted as another color
 * technique. It keeps its id, so the session (markers, yarns) stays with it.
 */
export function withTechnique(job, as) {
  const next = buildJob(deserialize(job.design), as);
  return { ...next, id: job.id, name: job.name, sentAt: job.sentAt };
}

/**
 * Each color technique this job could knit as, with what it costs on the
 * machine and what would go wrong: { id, label, title, passes, problems,
 * level }. For the knit screen's technique choice.
 */
export function techniqueOptions(job) {
  const project = deserialize(job.design);
  return colorTechniques().map((t) => {
    const as = { ...project, technique: t.id };
    const report = validateProject(as);
    const passes = compilePasses(as, 'panel').passes.filter((p) => !p.wrap).length;
    return { id: t.id, label: t.label, title: t.title, passes, problems: report.summary, level: report.level };
  });
}

/**
 * Bring a job saved by an older version up to the pass plan. Version 2 was
 * Fair Isle by construction: a top-first bitmap plus a { main, contrast }
 * pair per row, one pass per row.
 */
function upgradeJob(job) {
  if (!job || job.version >= 3) return job;
  const fromRows = ({ width, height, bits, rows }) => {
    const chart = new Array(width * height);
    const passes = [];
    for (let row = 0; row < height; row++) {
      const y = height - 1 - row;
      const { main, contrast, substituted } = rows[y];
      const line = bits.slice(y * width, y * width + width);
      line.forEach((bit, x) => (chart[y * width + x] = bit ? contrast : main));
      passes.push({ row, cam: 'fairisle', feeders: [main, contrast], bits: line, substituted });
    }
    return { width, height, chart, passes };
  };
  const { bits, rows, tile, ...rest } = job;
  return { ...rest, version: 3, ...fromRows(job), tile: tile ? fromRows(tile) : undefined };
}

/**
 * True when two jobs knit the same thing. Pressing Knit again on an unchanged
 * design then just returns to the knit screen instead of offering a "new" job.
 */
export function sameKnitting(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  const body = (j) => JSON.stringify([j.chart, j.passes, j.yarns, j.tile, j.technique ?? 'fairisle']);
  return body(a) === body(b);
}

// --- storage ----------------------------------------------------------------

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const loadJob = () => upgradeJob(readJson(JOB_KEY));
export const saveJob = (job) => writeJson(JOB_KEY, job);
export const loadSession = () => readJson(SESSION_KEY);
export const saveSession = (session) => writeJson(SESSION_KEY, session);

// --- the bed ----------------------------------------------------------------
//
// The bed is numbered out from the center, 1 to 100 on each side, and that is
// what the knitter reads off the machine and what the screen shows: L60, R60.
// Internally a needle is one signed number, left of center negative, with no
// needle 0 - silver-reed-write's pointCams - because that keeps the range
// arithmetic to plain subtraction. Convert only at the edge, with the helpers
// below; nothing the knitter sees should ever carry a minus sign.

/** Needles each side of center on a 200-needle bed. A machine's is `needles / 2`. */
export const BED_SIDE = 100;

/** Signed needle -> { side: 'L' | 'R', n: 1..100 }. */
export const toMarker = (needle) => (needle < 0 ? { side: 'L', n: -needle } : { side: 'R', n: needle });
export const fromMarker = (side, n) => (side === 'L' ? -n : n);
export const markerLabel = (needle) => (needle < 0 ? `L${-needle}` : `R${needle}`);

/** 0..(2 * side - 1) counting from the left end of the bed. */
export const bedPosition = (needle, side = BED_SIDE) => (needle < 0 ? side + needle : side - 1 + needle);
const fromBedPosition = (pos) => (pos < BED_SIDE ? pos - BED_SIDE : pos - BED_SIDE + 1);

export function needleCount(left, right) {
  if (left > right) return 0;
  return left < 0 && right > 0 ? right - left : right - left + 1;
}

/** Markers that put a `width`-stitch panel in the middle of the bed. */
export function centeredLayout(width) {
  return { left: -Math.ceil(width / 2), right: Math.max(1, Math.floor(width / 2)), align: 'center', endNeedles: true };
}

/** Where the panel lands between the markers: how many needles in from the left marker. */
function panelOffset(job, layout) {
  const slack = needleCount(layout.left, layout.right) - job.width;
  return layout.align === 'left' ? 0 : layout.align === 'right' ? slack : Math.floor(slack / 2);
}

/** The first and last needle the panel itself knits on, signed. */
export function panelNeedles(job, layout) {
  const first = bedPosition(layout.left) + panelOffset(job, layout);
  return [fromBedPosition(first), fromBedPosition(first + job.width - 1)];
}

/**
 * What is wrong with these markers for this job, or null. `side`: the bed's
 * needles each side of center. `maxRow`: the most needles the controller
 * selects in one row, when that is fewer than the bed has.
 */
export function layoutProblem(job, layout, side = BED_SIDE, maxRow = Infinity) {
  const count = needleCount(layout.left, layout.right);
  if (layout.left === 0 || layout.right === 0) return 'Needles are numbered from 1 on each side of center.';
  if (Math.abs(layout.left) > side || Math.abs(layout.right) > side) return `The bed has ${side} needles each side.`;
  if (count === 0) return 'The left marker must be to the left of the right marker.';
  if (count > maxRow) return `The controller selects at most ${maxRow} needles; the markers span ${count}.`;
  if (count < job.width) return `The panel is ${job.width} stitches but the markers span only ${count} needles.`;
  return null;
}

/**
 * What the knit screen actually knits, shaped like a job's panel fields
 * ({ width, height, chart, passes }) so the pass and bed maths take either.
 *
 * 'panel' is the panel as designed. 'tile' repeats the tile sideways to fill
 * every needle between the markers, phased by `layout.align` the way the
 * designer phases a repeat; vertically it is one tile tall and the knit
 * screen wraps it. A job from before tiles were carried knits its panel.
 */
export function knitGrid(job, scope, layout) {
  if (scope !== 'tile' || !job.tile) return job;
  const tile = job.tile;
  const count = needleCount(layout.left, layout.right);
  const width = count > 0 ? count : tile.width;
  const slack = width - tile.width;
  const phase = layout.align === 'left' ? 0 : layout.align === 'right' ? slack : Math.floor(slack / 2);
  const across = (line) => Array.from({ length: width }, (_, x) => line[(((x - phase) % tile.width) + tile.width) % tile.width]);
  const chart = [];
  for (let y = 0; y < tile.height; y++) chart.push(...across(tile.chart.slice(y * tile.width, y * tile.width + tile.width)));
  const passes = tile.passes.map((p) => ({ ...p, bits: across(p.bits) }));
  return { ...job, width, height: tile.height, chart, passes };
}

// --- yarns ------------------------------------------------------------------
//
// The design's colors are palette indices; at the machine the knitter loads
// cones, lettered A, B, C... in the order they are first needed. The knit
// screen maps each palette index to a yarn letter and may recolor a yarn, so a
// swatch in other colors never touches the design. Two design colors given
// the same letter are knitted from one cone. `withYarns` applies the mapping
// to a grid, so everything downstream - changes, sides, the chart, the
// controller's pass info - counts yarns, not design colors.

/** Yarn 0 is A. */
export const yarnLetter = (yarn) => String.fromCharCode(65 + yarn);

/** Palette indices the job knits, in the order a pass first uses them; the tile's last. */
function firstUse(job) {
  const seen = [];
  for (const pass of [...job.passes, ...(job.tile?.passes ?? [])]) {
    for (const index of pass.feeders) if (!seen.includes(index)) seen.push(index);
  }
  return seen;
}

/**
 * The yarn setup for a job: `map`, a yarn per palette index (null if the job
 * never knits it), and `yarns`, one `{ letter, hex, name, colors }` per yarn,
 * `colors` being the palette indices it knits. `letters` is the knit screen's
 * assignment (a yarn per palette index), used when it fits this job's
 * palette; `colors` overrides yarn colors by yarn number.
 */
export function yarnSetup(job, letters = null, colors = {}) {
  const used = firstUse(job);
  const fits = Array.isArray(letters) && letters.length === job.yarns.length;
  const map = job.yarns.map((_, index) => {
    if (!used.includes(index)) return null;
    return fits && Number.isInteger(letters[index]) ? letters[index] : used.indexOf(index);
  });
  const count = Math.max(0, ...map.filter((y) => y !== null).map((y) => y + 1));
  const yarns = Array.from({ length: count }, (_, yarn) => {
    const members = used.filter((index) => map[index] === yarn);
    const design = members.length ? job.yarns[members[0]].hex : '#808080';
    return {
      letter: yarnLetter(yarn),
      name: `Yarn ${yarnLetter(yarn)}`,
      hex: colors?.[yarn] ?? design,
      design,
      colors: members,
    };
  });
  return { map, yarns };
}

/**
 * `grid` with palette indices replaced by yarns. A Fair Isle row whose two
 * colors became one yarn keeps the neighboring rows' feeder pair, with every
 * needle on the feeder that yarn is in: sent as a one-yarn row it would take
 * feeder 1 everywhere (CLAUDE.md 1.4, the bed finding of 2026-10-26).
 */
export function withYarns(grid, { map, yarns }) {
  const toYarn = (index) => map[index] ?? 0;
  const mapped = grid.passes.map((p) => p.feeders.map(toYarn));
  const pairOf = (feeders) => (feeders.length === 2 && feeders[0] !== feeders[1] ? feeders : null);
  let held = null;
  for (let i = 0; i < mapped.length && !held; i++) if (grid.passes[i].cam === 'fairisle') held = pairOf(mapped[i]);

  const passes = grid.passes.map((p, i) => {
    const feeders = mapped[i];
    if (p.cam !== 'fairisle') return { ...p, feeders };
    const pair = pairOf(feeders);
    if (pair) {
      held = pair;
      return { ...p, feeders };
    }
    const yarn = feeders[0];
    if (held?.includes(yarn)) return { ...p, feeders: held, bits: new Array(p.bits.length).fill(held[1] === yarn ? 1 : 0) };
    return { ...p, feeders: [yarn], bits: new Array(p.bits.length).fill(0) };
  });
  return { ...grid, chart: grid.chart.map(toYarn), passes, yarns };
}

/** The pass that starts chart row `row` (0 = cast-on edge). */
export function firstPassOf(grid, row) {
  const starts = rowStarts(grid);
  return starts[Math.max(0, Math.min(grid.height - 1, row))];
}

/** Which of its row's passes this is, and how many the row has: { n: 1.., of }. */
export function passInRow(grid, passIndex) {
  const row = grid.passes[passIndex].row;
  let first = passIndex;
  while (first > 0 && grid.passes[first - 1].row === row) first--;
  let last = passIndex;
  while (last < grid.passes.length - 1 && grid.passes[last + 1].row === row) last++;
  return { n: passIndex - first + 1, of: last - first + 1 };
}

/**
 * The selection for one pass, one 0/1 per needle from the left marker to the
 * right marker, as the SK840 controller is sent it. Needles outside the panel
 * get 0. Other machines' drivers (knit/drivers/) convert from these terms, so
 * the corrections below and the knitting options mean the same on every bed.
 *
 * Two corrections, both found knitting Fair Isle on the SK840 (2026-10-24),
 * sit here and nowhere else, so the chart, the exports and the protocol stay
 * as they were:
 *
 * - Polarity. Threaded as the screen says (feeder 1 main, feeder 2 contrast),
 *   sending the chart's bits as they are knitted the two colors the wrong way
 *   round. So a contrast stitch is sent as 0 and a main stitch as 1.
 *   `opts.swap` undoes that: every stitch inverted, which is the same as the
 *   two yarns changing feeders (silver-reed-write's "negative"). Whether this
 *   is the wire's polarity or which feeder a selected needle takes is not yet
 *   known, so it is unverified for the slip and tuck cams.
 *   On every other cam a selected needle should knit and the rest tuck or
 *   slip (model/passes.js). They are sent with the same polarity - a needle
 *   that knits goes down as 0 - and `opts.invert` flips it, for when a
 *   swatch shows the knit and the tucked needles the wrong way round.
 * - Orientation. The chart is laid on the bed left to right from the left
 *   marker, which knits it the right way round on the knit side (2026-10-30).
 *   Laying it right to left, on the theory that the purl side faces the
 *   knitter, came out mirrored. `opts.mirror` flips it across the bed.
 *
 * @param {{swap?: boolean, mirror?: boolean, invert?: boolean}} [opts]
 */
export function needleRow(grid, layout, passIndex, { swap = false, mirror = false, invert = false } = {}) {
  const count = needleCount(layout.left, layout.right);
  const offset = panelOffset(grid, layout);

  const { bits, cam } = grid.passes[passIndex];
  const fairisle = cam === 'fairisle';
  const flip = fairisle ? swap : invert;
  // Outside the panel nothing is selected. On a tuck or slip cam that would
  // hold those needles, so there they get the "knit" value instead.
  const idle = fairisle ? 0 : flip ? 1 : 0;
  const out = new Array(count).fill(idle);
  for (let x = 0; x < grid.width; x++) {
    const needle = mirror ? offset + grid.width - 1 - x : offset + x;
    out[needle] = flip ? bits[x] : 1 - bits[x];
  }

  // End-needle selection keeps both yarns caught at the selvages, as in
  // silver-reed-write's endNeedleSelection. On the one-feeder cams it makes
  // the edge needles knit, so the selvage never tucks or slips.
  if (layout.endNeedles && count > 0) {
    const end = fairisle ? 1 : flip ? 1 : 0;
    out[0] = end;
    out[count - 1] = end;
  }
  return out;
}

/** Yarns for a pass, by feeder. */
export function yarnsFor(grid, passIndex, swap = false) {
  const pass = grid.passes[passIndex];
  const main = pass.feeders[0];
  const contrast = pass.feeders[1] ?? main;
  const [one, two] = swap && pass.cam === 'fairisle' ? [contrast, main] : [main, contrast];
  return {
    feeder1: grid.yarns[one],
    feeder2: grid.yarns[two],
    single: main === contrast,
    cam: pass.cam,
    ribber: Boolean(pass.ribber),
    substituted: pass.substituted,
  };
}

/** Palette index in feeder 1 and feeder 2 for a pass; feeder 2 is null on a one-yarn pass. */
export function feederSlots(pass, swap) {
  const main = pass.feeders[0];
  const contrast = pass.feeders[1] ?? main;
  if (main === contrast) return [main, null];
  return swap && pass.cam === 'fairisle' ? [contrast, main] : [main, contrast];
}

/**
 * What the knitter rethreads before pass `passIndex`: one entry per feeder
 * whose yarn differs from the pass before, `{ feeder: 1 | 2, from, to }` as
 * yarns (`from` null when that feeder was empty), plus `fromIndex` and
 * `toIndex`, their palette indices. A feeder a one-yarn pass
 * does not use is not a change. Empty for pass 0 unless `wrapped` (pass 0
 * follows the last pass of a repeat): before the first pass it is threading.
 */
export function yarnChanges(grid, passIndex, wrapped = false, swap = false) {
  if (passIndex === 0 && !wrapped) return [];
  const n = grid.passes.length;
  const before = feederSlots(grid.passes[(passIndex - 1 + n) % n], swap);
  const now = feederSlots(grid.passes[passIndex], swap);
  const changes = [];
  for (let i = 0; i < 2; i++) {
    if (now[i] === null || now[i] === before[i]) continue;
    changes.push({
      feeder: i + 1,
      from: before[i] === null ? null : grid.yarns[before[i]],
      to: grid.yarns[now[i]],
      fromIndex: before[i],
      toIndex: now[i],
    });
  }
  return changes;
}

const otherSide = (side) => (side === 'left' ? 'right' : 'left');

/**
 * Which side of the bed yarn `index` hangs on before pass `passIndex`, with
 * the carriage on `carriageSide` now. A yarn stays where the carriage ended
 * the last pass that knitted it, and the carriage swaps sides every pass, so
 * counting the passes since then is enough. null if no earlier pass used it
 * (counting back through a repeat when `wrapped`).
 */
export function yarnSide(grid, passIndex, index, carriageSide, wrapped = false) {
  const n = grid.passes.length;
  for (let back = 1; back <= n; back++) {
    const q = passIndex - back;
    if (q < 0 && !wrapped) return null;
    if (grid.passes[(q + n) % n].feeders.includes(index)) {
      return (back - 1) % 2 === 0 ? carriageSide : otherSide(carriageSide);
    }
  }
  return null;
}

/** True when a pass after `passIndex` knits yarn `index`, so it is parked rather than cut. */
export function yarnUsedAfter(grid, passIndex, index, repeat = false) {
  const n = grid.passes.length;
  const end = repeat ? passIndex + n : n;
  for (let q = passIndex + 1; q < end; q++) {
    if (grid.passes[q % n].feeders.includes(index)) return true;
  }
  return false;
}

/**
 * The next pass after `passIndex` that needs a rethread: `{ passIndex, ahead,
 * changes }`, `ahead` 1 for the very next pass. null if none is left.
 */
export function nextChange(grid, passIndex, repeat = false, swap = false) {
  const n = grid.passes.length;
  const end = repeat ? passIndex + n : n;
  for (let q = passIndex + 1; q < end; q++) {
    const changes = yarnChanges(grid, q % n, true, swap);
    if (changes.length) return { passIndex: q % n, ahead: q - passIndex, changes };
  }
  return null;
}
