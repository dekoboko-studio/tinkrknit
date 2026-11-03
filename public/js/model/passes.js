/**
 * The pass plan: what the carriage does, pass by pass.
 *
 * Every single-bed technique sends the machine the same thing - one row of
 * needle selections per carriage pass (CLAUDE.md 1.1). What differs is around
 * those bits: how many passes make a chart row, which yarns are in the
 * feeders, and which cam buttons the knitter has set. So a technique is a
 * compiler from the project to a plan, and everything that knits or simulates
 * reads the plan rather than the chart:
 *
 *   plan = {
 *     technique, width, height,   width in stitches, height in chart rows
 *     chart,        Uint8Array, row-major, top row first (CLAUDE.md 4): the
 *                   palette index each stitch shows once knitted. For Fair
 *                   Isle it is the design after any row was reduced to two
 *                   colors; for slip and tuck it is the intended result.
 *     passes,       in knitting order, cast-on first:
 *                   { row, cam, feeders, bits, ribber?, backing? }
 *                     row      chart row, 0 = the cast-on edge
 *                     cam      the carriage setting (CAMS below)
 *                     feeders  palette indices by feeder: [feeder 1, feeder 2]
 *                              for Fair Isle, [feeder 1] for everything else
 *                     bits     one per stitch, chart left to right;
 *                              1 = needle selected
 *                     ribber   the ribber knits this pass too
 *                     backing  jacquard: the backing the ribber knits
 *     substitutions [{ row, x, from, to }], row counted from the cast-on, 1-based:
 *                   stitches that cannot be knitted as drawn and show `to`
 *   }
 *
 * What a selected needle does depends on the cam. On every cam but Fair
 * Isle a selected needle knits and an unselected one tucks or slips, which is
 * the machine convention; whether the SK840's wire agrees is a swatch test
 * away (CLAUDE.md 1.4), so the knit screen can invert it per job.
 *
 * A pass knows nothing of the bed. Where it lands between the markers, the
 * mirroring and the wire polarity are the knit screen's (knit/job.js).
 */

import { expandPanel } from './project.js';
import { reduceRowToPair } from './validate.js';
import { hexToRgb, colorAt } from './palette.js';
import { getTechnique, passesPerColor, getBacking } from './technique.js';
import { KNIT, TUCK, SLIP, stitchLayer } from './stitch.js';

/**
 * Carriage settings. `unselected` is what a needle the pattern does not select
 * does on that cam; Fair Isle knits it in feeder 1.
 */
export const CAMS = {
  fairisle: { id: 'fairisle', label: 'Fair Isle', unselected: KNIT },
  tuck: { id: 'tuck', label: 'Tuck', unselected: TUCK },
  slip: { id: 'slip', label: 'Slip', unselected: SLIP },
  plain: { id: 'plain', label: 'Plain', unselected: KNIT },
  jacquard: { id: 'jacquard', label: 'Jacquard', unselected: SLIP },
};

/**
 * What one needle does on one pass, and in which yarn: { op, yarn }. The one
 * place the cams are interpreted, shared by the structure preview and the
 * stitch chart, so neither guesses at what a bit means.
 */
export function stitchOf(pass, x) {
  const bit = pass.bits[x];
  if (pass.cam === 'fairisle') return { op: KNIT, yarn: pass.feeders[bit && pass.feeders.length > 1 ? 1 : 0] };
  return { op: bit ? KNIT : CAMS[pass.cam]?.unselected ?? KNIT, yarn: pass.feeders[0] };
}

/** Snap an out-of-budget color to whichever of the row's two yarns is nearer. */
function nearestOfPair(palette, index, pair) {
  const [r, g, b] = hexToRgb(colorAt(palette, index));
  let best = pair[0];
  let bestD = Infinity;
  for (const candidate of pair) {
    const [cr, cg, cb] = hexToRgb(colorAt(palette, candidate));
    const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = candidate;
    }
  }
  return best;
}

/**
 * Fair Isle: one pass per row, two feeders. Feeder 1 knits the unselected
 * needles and feeder 2 the selected ones. A row with more than two colors is
 * reduced to its two dominant ones and every changed stitch is reported.
 */
function fairislePlan(project, grid) {
  const { w, h } = grid;
  const chart = new Uint8Array(w * h);
  const passes = [];
  const substitutions = [];

  const reductions = [];
  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    reductions.push(reduceRowToPair(grid.data.subarray(y * w, y * w + w), project.palette, nearestOfPair));
  }

  // Lower palette index is the main feeder. Keeping that rule consistent
  // across rows means the ground color stays in feeder 1 down the whole
  // piece, instead of swapping whenever a row is mostly contrast.
  const pairs = reductions.map((r) => [...r.pair].sort((a, b) => a - b));

  // A one-color row keeps the feeders the rows around it are threaded with:
  // a solid line of the contrast is every needle selected, taking feeder 2
  // where that yarn already is. Treated as its own one-yarn row it went out
  // as "all feeder 1", knitted in the ground, and floated the line behind
  // (found on the bed 2026-10-26). A color neither feeder holds goes in
  // feeder 2, so the ground stays put.
  let held = pairs.find((p) => p.length === 2) ?? null;

  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    const reduction = reductions[row];
    let pair = pairs[row];
    if (pair.length === 2) held = pair;
    else if (pair.length === 1 && held) {
      pair = held.includes(pair[0]) ? held : [held[0], pair[0]];
      held = pair;
    }
    const main = pair[0] ?? 0;
    const contrast = pair[1] ?? main;

    const bits = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const v = reduction.reduced[x];
      bits[x] = v === contrast && contrast !== main ? 1 : 0;
      chart[y * w + x] = bits[x] ? contrast : main;
    }
    passes.push({ row, cam: 'fairisle', feeders: [main, contrast], bits, substituted: reduction.substitutions.length });
    for (const sub of reduction.substitutions) substitutions.push({ row: row + 1, ...sub });
  }
  return { chart, passes, substitutions };
}

/** Colors in a row, ground first (lowest index), as the passes knit them. */
function rowColors(row) {
  return [...new Set(row)].sort((a, b) => a - b);
}

/** One color's selection: its needles knit, the rest slip. */
function colorBits(row, color) {
  const bits = new Uint8Array(row.length);
  for (let x = 0; x < row.length; x++) bits[x] = row[x] === color ? 1 : 0;
  return bits;
}

/**
 * Slip stitch colorwork: every color in a row gets its own passes, knitting
 * its needles and slipping the rest, so the row comes out exactly as drawn
 * whatever its color count. The cost is passes: colors x passes-per-color.
 * A one-color row is knitted plain.
 */
function slipColorPlan(project, grid) {
  const { w, h } = grid;
  const per = passesPerColor(project);
  const passes = [];
  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    const line = grid.data.subarray(y * w, y * w + w);
    const colors = rowColors(line);
    for (const color of colors) {
      const plain = colors.length === 1;
      const bits = plain ? new Uint8Array(w).fill(1) : colorBits(line, color);
      for (let i = 0; i < per; i++) passes.push({ row, cam: plain ? 'plain' : 'slip', feeders: [color], bits, substituted: 0 });
    }
  }
  return { chart: grid.data.slice(), passes, substitutions: [] };
}

/**
 * Double-bed jacquard: one color at a time on the main bed, as slip stitch
 * does, with the ribber knitting the back on every pass. The main carriage
 * slips what it does not select; the backing is set on the ribber carriage.
 */
function jacquardPlan(project, grid) {
  const plan = slipColorPlan(project, grid);
  const backing = getBacking(project.jacquardBacking).id;
  for (const pass of plan.passes) {
    pass.cam = 'jacquard';
    pass.ribber = true;
    pass.backing = backing;
  }
  return plan;
}

/**
 * Mosaic: one yarn per row, inferred from the color chart.
 *
 * Walking up from the cast-on, each row picks the yarn that lets the most of
 * its stitches come out right. A stitch of the row's yarn knits. A stitch of
 * another color is slipped, which leaves the stitch below in place and so
 * shows its color - right if the stitch below shows the color wanted and has
 * not already been held too long (`validation.maxSlip` passes). Anything else
 * cannot be made and knits in the row's yarn; it is reported as a
 * substitution, as Fair Isle reports a reduced row.
 *
 * Ties go to the yarn the previous row did not use. Alternating is what
 * classic mosaic does, and it keeps every slip one row long.
 */
function mosaicPlan(project, grid) {
  const { w, h } = grid;
  const per = passesPerColor(project);
  const maxSlip = project.validation?.maxSlip ?? 4;
  const chart = new Uint8Array(w * h);
  const passes = [];
  const substitutions = [];

  const shown = new Int16Array(w).fill(-1); // what each column shows so far
  const held = new Uint16Array(w); // passes the stitch below has been slipped
  let previous = -1;

  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    const want = grid.data.subarray(y * w, y * w + w);
    const canSlip = (x) => shown[x] === want[x] && held[x] + per <= maxSlip;

    let yarn = want[0];
    let best = Infinity;
    for (const candidate of rowColors(want)) {
      let wrong = 0;
      for (let x = 0; x < w; x++) if (want[x] !== candidate && !canSlip(x)) wrong++;
      const better = wrong < best || (wrong === best && yarn === previous && candidate !== previous);
      if (better) {
        best = wrong;
        yarn = candidate;
      }
    }

    const bits = new Uint8Array(w);
    let substituted = 0;
    for (let x = 0; x < w; x++) {
      if (want[x] !== yarn && canSlip(x)) {
        held[x] += per;
      } else {
        bits[x] = 1;
        held[x] = 0;
        if (want[x] !== yarn) {
          substitutions.push({ row: row + 1, x, from: want[x], to: yarn });
          substituted++;
        }
        shown[x] = yarn;
      }
      chart[y * w + x] = shown[x];
    }

    const plain = bits.every((b) => b);
    for (let i = 0; i < per; i++) passes.push({ row, cam: plain ? 'plain' : 'slip', feeders: [yarn], bits, substituted });
    previous = yarn;
  }
  return { chart, passes, substitutions };
}

/** The yarn for a texture row: its most used color, lowest index on a tie. */
export function rowYarn(line) {
  const counts = new Map();
  for (const v of line) counts.set(v, (counts.get(v) ?? 0) + 1);
  let yarn = line[0];
  for (const [v, n] of counts) {
    const m = counts.get(yarn);
    if (n > m || (n === m && v < yarn)) yarn = v;
  }
  return yarn;
}

/**
 * Tuck & slip: the stitch layer, one pass per chart row, in the row's yarn.
 *
 * The cam is per pass, so a row is tuck, slip or plain. A row holding both
 * takes whichever it has more of and knits the others; the checks flag it.
 * The chart shows what each stitch looks like from the front: a tucked or
 * slipped needle still shows the stitch below it.
 */
function texturePlan(project, grid, ops) {
  const { w, h } = grid;
  const chart = new Uint8Array(w * h);
  const passes = [];
  const shown = new Int16Array(w).fill(-1);
  const ribber = Boolean(project.stitch?.ribber);

  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    const line = grid.data.subarray(y * w, y * w + w);
    const opLine = ops.data.subarray(y * w, y * w + w);
    const yarn = rowYarn(line);

    let tucks = 0;
    let slips = 0;
    for (const op of opLine) {
      if (op === TUCK) tucks++;
      else if (op === SLIP) slips++;
    }
    const cam = tucks === 0 && slips === 0 ? 'plain' : tucks >= slips ? 'tuck' : 'slip';
    const held = cam === 'tuck' ? TUCK : SLIP;

    const bits = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const knits = cam === 'plain' || opLine[x] !== held;
      bits[x] = knits ? 1 : 0;
      // A needle that is held shows the stitch below; the cast-on row has none.
      if (knits || shown[x] < 0) shown[x] = yarn;
      chart[y * w + x] = shown[x];
    }
    passes.push({ row, cam, feeders: [yarn], bits, substituted: 0, ...(ribber ? { ribber } : {}) });
  }
  return { chart, passes, substitutions: [] };
}

/** Technique id -> compiler. Each takes (project, colors, stitches). */
const COMPILERS = {
  fairisle: fairislePlan,
  jacquard: jacquardPlan,
  slipcolor: slipColorPlan,
  mosaic: mosaicPlan,
  texture: texturePlan,
};

/**
 * Compile the project into a pass plan.
 * @param {'panel'|'tile'} scope the whole piece, or one repeat
 * @param {string} [as] compile as this technique instead of the project's -
 *        the exports are Fair Isle files whatever the design says
 */
export function compilePasses(project, scope = 'panel', as = project.technique) {
  const technique = getTechnique(as).id;
  const grid = scope === 'tile' ? project.tile : expandPanel(project);
  const ops = technique !== 'texture' ? null
    : scope === 'tile' ? stitchLayer(project) : expandPanel(project, stitchLayer(project));
  const compile = COMPILERS[technique] ?? fairislePlan;
  return { technique, width: grid.w, height: grid.h, ...compile(project, grid, ops) };
}

/**
 * The stitch chart a plan amounts to, one row per pass: the op every needle
 * makes and the pass's yarn. This is the common form both ways in arrive at -
 * drawn on the stitch layer or inferred from colors - and what turns a mosaic
 * into an editable Tuck & slip chart.
 * @returns {{ width, height, ops: Uint8Array, yarns: number[] }} top pass first
 */
export function stitchChart(plan) {
  const { width, passes } = plan;
  const height = passes.length;
  const ops = new Uint8Array(width * height);
  const yarns = [];
  passes.forEach((pass, i) => {
    const y = height - 1 - i;
    yarns[y] = pass.feeders[0];
    for (let x = 0; x < width; x++) ops[y * width + x] = stitchOf(pass, x).op;
  });
  return { width, height, ops, yarns };
}

/** The first pass of each chart row, indexed by row; rows run 0..height-1. */
export function rowStarts(plan) {
  const starts = new Array(plan.height).fill(-1);
  for (let i = plan.passes.length - 1; i >= 0; i--) starts[plan.passes[i].row] = i;
  return starts;
}
