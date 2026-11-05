/**
 * Knittability checks.
 *
 * Which rules apply depends on the technique (`model/technique.js`). For
 * single-bed Fair Isle, two:
 *
 *  1. **Two colors per row.** The carriage has one main feeder and one
 *     contrast feeder. Three colors in a row cannot be knitted as drawn
 *     (CLAUDE.md 1.2).
 *  2. **Float length.** The color not being knitted is carried loose across
 *     the back. Long floats snag on fingers and pull the fabric in.
 *
 * Double-bed jacquard keeps only the first, with the colors-per-row limit
 * set in the project: the back is knitted on the ribber, so nothing floats.
 *
 * The one-feeder techniques (slip stitch, mosaic, tuck & slip) are judged on
 * their pass plan instead (`passChecks`): a pass that knits nothing, a loop
 * held too long, a slip float, a stitch mosaic cannot make, and a yarn left
 * on the far side of the bed.
 *
 * Checks run against the *expanded panel*, not the tile, because a float can
 * run across a tile seam and a row's color count is a property of the row as
 * actually knitted.
 *
 * Nothing here blocks editing. It reports (CLAUDE.md 6).
 */

import { panelRow, tileRowFor, expandStitches } from './project.js';
import { getTechnique, colorsPerRow, passesPerColor } from './technique.js';
import { compilePasses, stitchOf } from './passes.js';
import { KNIT, TUCK, SLIP } from './stitch.js';

/** Distinct indices plus same-color runs for one row. */
export function analyzeRow(row, threshold) {
  const colors = [];
  const seen = new Uint8Array(256);
  const runs = [];

  let runStart = 0;
  for (let x = 0; x < row.length; x++) {
    const v = row[x];
    if (!seen[v]) {
      seen[v] = 1;
      colors.push(v);
    }
    if (x === row.length - 1 || row[x + 1] !== v) {
      runs.push({ start: runStart, len: x - runStart + 1, index: v });
      runStart = x + 1;
    }
  }

  // A single-color row carries no second yarn, so it has no floats at all.
  const floats =
    colors.length < 2 ? [] : runs.filter((r) => r.len > threshold);

  return { colors, runs, floats };
}

export function validateProject(project) {
  const technique = getTechnique(project.technique);
  const maxColors = colorsPerRow(project);
  // Infinity rather than a branch, so no run is ever "long" and the row loop
  // stays the same for every technique.
  const threshold = technique.floats ? project.validation?.floatThreshold ?? 7 : Infinity;

  const rows = [];
  const buffer = new Uint8Array(project.panel.w);
  let tooManyColors = 0;
  let longFloats = 0;
  const badTileRows = new Set();

  for (let y = 0; y < project.panel.h; y++) {
    const row = panelRow(project, y, buffer);
    const { colors, floats } = analyzeRow(row, threshold);
    const tooMany = colors.length > maxColors;

    if (tooMany) tooManyColors++;
    longFloats += floats.length;

    const tileY = tileRowFor(project, y);
    if ((tooMany || floats.length) && tileY >= 0) badTileRows.add(tileY);

    rows.push({
      y,
      tileY,
      knitRow: project.panel.h - y, // row 1 is the cast-on edge
      colors,
      tooMany,
      floats,
      longestFloat: floats.reduce((m, f) => Math.max(m, f.len), 0),
      /** Other findings for this row: { level: 'error'|'warn', label }. */
      issues: [],
    });
  }

  const errors = [];
  const warnings = [];
  const counts = { tooManyColors, longFloats };
  if (!technique.floats && technique.id !== 'jacquard') {
    passChecks(project, technique, rows, errors, warnings, counts);
    for (const row of rows) if (row.issues.length && row.tileY >= 0) badTileRows.add(row.tileY);
  }

  if (tooManyColors > 0) {
    errors.push({
      code: 'colors-per-row',
      message:
        `${tooManyColors} row${tooManyColors === 1 ? '' : 's'} use more than ` +
        `${maxColors} colors. ` +
        (technique.floats
          ? `${technique.label} knits ${maxColors} per row, ` +
            `so these rows will be reduced on export.`
          : `${technique.label} is set to ${maxColors} colors per row.`),
    });
  }
  if (longFloats > 0) {
    warnings.push({
      code: 'float-length',
      message:
        `${longFloats} float${longFloats === 1 ? '' : 's'} run longer than ` +
        `${threshold} stitches. Consider breaking them up or catching them by hand.`,
    });
  }

  // `ok` is "exports without changes"; a design with only warnings is ok but
  // not clean, so anything showing a verdict reads `level`, not `ok`.
  return {
    ok: errors.length === 0,
    level: errors.length ? 'error' : warnings.length ? 'warn' : 'ok',
    rows,
    errors,
    warnings,
    badTileRows,
    counts,
    summary: summarize(counts, maxColors),
    threshold,
    maxColors,
    technique: technique.id,
  };
}

/** What is wrong, in a few words, for the status bar and the panel headline. */
function summarize(counts, maxColors) {
  const n = (count, one, many = `${one}s`) => (count ? `${count} ${count === 1 ? one : many}` : null);
  return [
    counts.tooManyColors ? `${counts.tooManyColors} rows over ${maxColors} colors` : null,
    n(counts.longFloats, 'long float'),
    n(counts.unmade, 'stitch mosaic cannot make', 'stitches mosaic cannot make'),
    n(counts.empty, 'pass knitting nothing', 'passes knitting nothing'),
    n(counts.mixed, 'row mixing tuck and slip', 'rows mixing tuck and slip'),
    n(counts.held, 'loop held too long', 'loops held too long'),
    n(counts.multiColor, 'texture row with two colors', 'texture rows with two colors'),
    n(counts.farSide, 'yarn on the far side', 'yarns on the far side'),
  ].filter(Boolean);
}

/**
 * The one-feeder techniques, checked pass by pass on the panel's plan.
 *
 *  - Every pass must knit something, or the carriage drags the yarn across
 *    the bed and drops it. A ribber pass always does, on the ribber.
 *  - A tucked loop can only be held a few passes before it is too tight to
 *    knit off (`maxTuck`); a slipped stitch likewise (`maxSlip`).
 *  - The yarn floats behind every slipped needle, so a run of slips is a
 *    float like Fair Isle's.
 *  - A pass's cam is set once for the pass, so a Tuck & slip row cannot hold
 *    both; and its yarn is one color, so a second color is ignored.
 *  - Mosaic reports stitches it could not make by slipping.
 *  - With one feeder the yarn is changed by hand at the carriage. A yarn last
 *    used on a pass that ended on the other side is not there when it is
 *    next needed, and must be cut and rejoined.
 */
function passChecks(project, technique, rows, errors, warnings, counts) {
  const plan = compilePasses(project, 'panel');
  const { width, height, passes } = plan;
  const limit = project.validation?.floatThreshold ?? 7;
  const maxTuck = project.validation?.maxTuck ?? 4;
  const maxSlip = project.validation?.maxSlip ?? 4;
  const flag = (row, level, label) => {
    const entry = rows[height - 1 - row];
    if (entry && !entry.issues.some((i) => i.label === label)) entry.issues.push({ level, label });
  };

  Object.assign(counts, { unmade: 0, empty: 0, mixed: 0, held: 0, multiColor: 0, farSide: 0 });

  const tucked = new Uint16Array(width);
  const idle = new Uint16Array(width);
  const lastEnd = new Map(); // yarn -> parity of the side its last pass ended on

  passes.forEach((pass, i) => {
    let knits = 0;
    let run = 0;
    for (let x = 0; x <= width; x++) {
      const op = x < width ? stitchOf(pass, x).op : KNIT;
      if (op === KNIT) {
        if (x < width) knits++;
        // With the ribber knitting, a slipped needle's yarn goes to the back bed: no float.
        if (run > limit && !pass.ribber) {
          counts.longFloats++;
          flag(pass.row, 'warn', 'long float');
        }
        run = 0;
      } else if (op === SLIP) {
        run++;
      }
      if (x === width) break;

      tucked[x] = op === TUCK ? tucked[x] + 1 : 0;
      idle[x] = op === KNIT ? 0 : idle[x] + 1;
      if (tucked[x] === maxTuck + 1 || (op === SLIP && idle[x] === maxSlip + 1)) {
        counts.held++;
        flag(pass.row, 'warn', op === TUCK ? 'tuck held' : 'slip held');
      }
    }
    if (!knits && !pass.ribber) {
      counts.empty++;
      flag(pass.row, 'error', 'knits nothing');
    }

    // Pass i starts from the cast-on side when i is even. A yarn is where its
    // last pass left it, which is the start side of pass i + 1.
    const yarn = pass.feeders[0];
    if (lastEnd.has(yarn) && lastEnd.get(yarn) !== i % 2 && passes[i - 1]?.feeders[0] !== yarn) {
      counts.farSide++;
      flag(pass.row, 'warn', 'yarn far side');
    }
    lastEnd.set(yarn, (i + 1) % 2);
  });

  if (technique.id === 'texture') {
    for (const row of rows) {
      if (row.colors.length > 1) {
        counts.multiColor++;
        row.issues.push({ level: 'warn', label: `${row.colors.length} colors` });
      }
    }
    const ops = expandStitches(project);
    for (let y = 0; y < height; y++) {
      let tuck = false;
      let slip = false;
      for (let x = 0; x < width; x++) {
        const op = ops.data[y * width + x];
        tuck ||= op === TUCK;
        slip ||= op === SLIP;
      }
      if (tuck && slip) {
        counts.mixed++;
        rows[y].issues.push({ level: 'error', label: 'tuck and slip' });
      }
    }
  }

  if (technique.id === 'mosaic') {
    counts.unmade = plan.substitutions.length;
    for (const sub of plan.substitutions) flag(sub.row - 1, 'error', 'cannot slip');
  }

  const per = passesPerColor(project);
  if (counts.unmade) {
    errors.push({
      code: 'mosaic-unmade',
      message:
        `${counts.unmade} stitch${counts.unmade === 1 ? '' : 'es'} cannot be made by slipping: ` +
        `the stitch below is another color or already held ${maxSlip} passes. ` +
        `They knit in the row's yarn.`,
    });
  }
  if (counts.empty) {
    errors.push({
      code: 'empty-pass',
      message: `${counts.empty} pass${counts.empty === 1 ? '' : 'es'} knit no stitch at all. Every pass needs some needles knitting.`,
    });
  }
  if (counts.mixed) {
    errors.push({
      code: 'mixed-cam',
      message: `${counts.mixed} row${counts.mixed === 1 ? '' : 's'} mix tuck and slip. The cam is set once per pass, so the fewer of the two will knit.`,
    });
  }
  if (counts.longFloats) {
    warnings.push({
      code: 'float-length',
      message: `${counts.longFloats} slip float${counts.longFloats === 1 ? '' : 's'} run longer than ${limit} stitches.`,
    });
  }
  if (counts.held) {
    warnings.push({
      code: 'held-loops',
      message: `${counts.held} loop${counts.held === 1 ? ' is' : 's are'} held longer than ${maxTuck} tucks or ${maxSlip} slipped passes, and may not knit off.`,
    });
  }
  if (counts.multiColor) {
    warnings.push({
      code: 'texture-colors',
      message: `${counts.multiColor} row${counts.multiColor === 1 ? ' has' : 's have'} more than one color. Tuck & slip knits each row in one yarn, its most used color.`,
    });
  }
  if (counts.farSide) {
    warnings.push({
      code: 'far-side',
      message:
        `${counts.farSide} time${counts.farSide === 1 ? '' : 's'} a yarn is needed on the side of the bed it is not on, and has to be cut and rejoined.` +
        (per === 1 ? ' Two passes per color keeps every yarn on one side.' : ''),
    });
  }
}

/**
 * Reduce a row to the two colors the machine can actually knit.
 *
 * Keeps the two most-used colors and snaps the rest to whichever of those two
 * is nearer in RGB. Used by the exporter so a design with a busy row still
 * produces a usable file, with the substitution reported rather than hidden.
 */
export function reduceRowToPair(row, palette, nearestOf) {
  const counts = new Map();
  for (let x = 0; x < row.length; x++) {
    counts.set(row[x], (counts.get(row[x]) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  if (ranked.length <= 2) {
    return { pair: ranked, substitutions: [], reduced: row };
  }

  // Lower palette index wins ties for "main", which keeps a consistent ground
  // color across rows rather than flipping with pixel counts.
  const pair = ranked.slice(0, 2).sort((a, b) => a - b);
  const substitutions = [];
  const reduced = new Uint8Array(row.length);

  for (let x = 0; x < row.length; x++) {
    const v = row[x];
    if (pair.includes(v)) {
      reduced[x] = v;
      continue;
    }
    const to = nearestOf(palette, v, pair);
    reduced[x] = to;
    substitutions.push({ x, from: v, to });
  }
  return { pair, substitutions, reduced };
}
