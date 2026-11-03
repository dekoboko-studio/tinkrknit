/**
 * Hand-off to knitscape/silver-reed-write.
 *
 * The machine takes a 1-bit needle-selection grid plus, for each row, the pair
 * of yarns currently threaded. That is exactly silver-reed-write's model:
 *
 *   bitmap           0 = main feeder, 1 = contrast feeder
 *   fairisleColors   one { yarn1, yarn2 } per row
 *   patternConfig    tiling/mirroring, applied by that tool
 *
 * A design with more than two colors in a row cannot be knitted as drawn
 * (CLAUDE.md 1.2). Rather than refusing, we reduce those rows to their two
 * dominant colors and report every substitution so the change is visible
 * rather than silent.
 */

import { expandPanel } from '../model/project.js';
import { compilePasses } from '../model/passes.js';
import { hexToRgb, colorAt } from '../model/palette.js';
import { createBitmap } from '../model/bitmap.js';

/**
 * Decompose a project into machine data: the Fair Isle pass plan
 * (model/passes.js), reshaped into silver-reed-write's top-first bitmap and
 * per-row yarn pairs. Always Fair Isle - that tool drives a single bed.
 * @param {object} project
 * @param {'panel'|'tile'} scope panel = the whole piece; tile = let
 *        silver-reed-write do the repeating from patternConfig.
 */
export function decompose(project, scope = 'panel') {
  const grid = scope === 'tile' ? project.tile : expandPanel(project);
  const plan = compilePasses(project, scope, 'fairisle');
  const bits = createBitmap(plan.width, plan.height);
  const fairisleColors = [];
  const rowPlan = [];

  // One pass per row, cast-on first; walk them top row first to match the bitmap.
  for (let y = 0; y < plan.height; y++) {
    const pass = plan.passes[plan.height - 1 - y];
    const [main, contrast] = pass.feeders;
    bits.data.set(pass.bits, y * plan.width);

    fairisleColors.push({
      yarn1: hexToRgb(colorAt(project.palette, main)),
      yarn2: hexToRgb(colorAt(project.palette, contrast)),
    });

    rowPlan.push({
      row: plan.height - y, // counted from the cast-on edge
      main,
      contrast,
      singleColor: contrast === main,
      substituted: pass.substituted,
    });
  }

  // The plan lists substitutions cast-on first; this file has always listed them top first.
  const substitutions = [...plan.substitutions].sort((a, b) => b.row - a.row);
  return { bits, fairisleColors, rowPlan, substitutions, scope, grid };
}

/**
 * patternConfig shaped to silver-reed-write's `PatternConfig` type.
 * End-needle selection is on by default: it keeps both yarns caught at the
 * selvages, which is standard practice for Fair Isle.
 */
export function patternConfig(project, scope, height) {
  const tiling = scope === 'tile';
  return {
    double_cols: false,
    double_rows: false,
    negative: false,
    mirror_vertical: false,
    mirror_horizontal: false,
    repeat_horizontal: tiling ? project.repeat.horizontal : false,
    repeat_vertical: tiling ? project.repeat.vertical : false,
    alignment: project.repeat.alignment,
    endNeedleSelection: true,
    marginLeft: 0,
    marginRight: 0,
    height,
    heightFromTile: false,
  };
}

/** The full JSON payload written alongside the PNG. */
export function buildPayload(project, scope = 'panel') {
  const { bits, fairisleColors, rowPlan, substitutions } = decompose(project, scope);

  return {
    generator: 'tinkrknit',
    generatedAt: new Date().toISOString(),
    target: 'knitscape/silver-reed-write',
    project: {
      name: project.name,
      scope,
      width: bits.w,
      height: bits.h,
      gauge: project.gauge,
    },
    bitmap: {
      width: bits.w,
      height: bits.h,
      /** Row-major, 0 = main feeder, 1 = contrast feeder. */
      data: Array.from(bits.data),
    },
    fairisleColors,
    patternConfig: patternConfig(project, scope, bits.h),
    yarns: project.palette.map((slot, index) => ({
      index,
      name: slot.name,
      color: hexToRgb(slot.color),
      hex: slot.color,
    })),
    rowPlan,
    substitutions,
  };
}

/**
 * A plain-text knitting plan. Reading a JSON file at the machine is miserable;
 * this lists only the rows where the threading actually has to change.
 */
export function buildKnittingPlan(project, scope = 'panel') {
  const { rowPlan, substitutions } = decompose(project, scope);
  const nameOf = (index) =>
    project.palette[index]?.name || `Color ${index + 1}`;

  const lines = [
    `${project.name} - knitting plan`,
    `Scope: ${scope}`,
    `Panel: ${project.panel.w} sts x ${project.panel.h} rows`,
    `Gauge: ${project.gauge.stsPer10} sts / ${project.gauge.rowsPer10} rows per 10cm`,
    '',
    'Rows are numbered from the cast-on edge upward.',
    'Feeder 1 = main, feeder 2 = contrast.',
    '',
  ];

  // Walk bottom-up and note only the changes.
  const ordered = [...rowPlan].sort((a, b) => a.row - b.row);
  let previous = null;

  for (const entry of ordered) {
    const signature = `${entry.main}/${entry.contrast}`;
    if (signature === previous) continue;
    previous = signature;

    lines.push(
      entry.singleColor
        ? `Row ${entry.row}: plain - ${nameOf(entry.main)} only`
        : `Row ${entry.row}: feeder 1 ${nameOf(entry.main)}, feeder 2 ${nameOf(entry.contrast)}`
    );
  }

  if (substitutions.length) {
    lines.push(
      '',
      `WARNING: ${substitutions.length} stitches were changed because their row`,
      'used more than two colors. Affected rows (from cast-on):',
      '  ' + [...new Set(substitutions.map((s) => s.row))].sort((a, b) => a - b).join(', ')
    );
  }

  return lines.join('\n');
}
