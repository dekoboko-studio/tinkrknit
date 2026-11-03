/**
 * Gauge maths.
 *
 * Gauge is always stored per 10cm, the standard swatch measurement. Everything
 * else converts through it. Knit a real swatch in the pattern stitch and
 * measure it — Fair Isle pulls in noticeably tighter than plain stockinette,
 * so a stockinette swatch will lie to you.
 */

export const CM_PER_INCH = 2.54;

export const toCm = (inches) => inches * CM_PER_INCH;
export const toInches = (cm) => cm / CM_PER_INCH;

export function stitchesForCm(cm, stsPer10) {
  return Math.max(1, Math.round((cm / 10) * stsPer10));
}

export function rowsForCm(cm, rowsPer10) {
  return Math.max(1, Math.round((cm / 10) * rowsPer10));
}

export const cmForStitches = (sts, stsPer10) => (sts / stsPer10) * 10;
export const cmForRows = (rows, rowsPer10) => (rows / rowsPer10) * 10;

/**
 * A stitch is wider than it is tall. The preview needs that ratio or the knit
 * simulation looks like square pixel art, which is the thing we are trying to
 * get away from.
 */
export function stitchAspect(gauge) {
  const { stsPer10, rowsPer10 } = gauge;
  if (!stsPer10 || !rowsPer10) return 4 / 3;
  return rowsPer10 / stsPer10;
}

/**
 * Size a flat hat panel.
 *
 * Hats want negative ease so they grip: the knitted circumference is smaller
 * than the head. `ease` is a fraction, so -0.1 means 10% smaller.
 *
 * The panel is knitted flat and seamed, so its width is the full finished
 * circumference plus a seam allowance.
 */
export function hatPanel({
  headCm = 56,
  ease = -0.1,
  heightCm = 22,
  gauge,
  seamStitches = 2,
  ribRows = 0,
}) {
  const finishedCm = headCm * (1 + ease);
  const bodyStitches = stitchesForCm(finishedCm, gauge.stsPer10);
  const panelW = bodyStitches + seamStitches * 2;
  const panelH = rowsForCm(heightCm, gauge.rowsPer10);

  return {
    finishedCm: Number(finishedCm.toFixed(1)),
    bodyStitches,
    panelW,
    panelH,
    patternRows: Math.max(1, panelH - ribRows),
    notes: [
      `Finished circumference ${finishedCm.toFixed(1)}cm ` +
        `(${(ease * 100).toFixed(0)}% ease on a ${headCm}cm head).`,
      `${panelW} stitches includes ${seamStitches} seam stitches each side.`,
      ribRows > 0 ? `${ribRows} rows of ribbing before the pattern starts.` : null,
    ].filter(Boolean),
  };
}

/** Yardage estimate. Rough by nature; treat it as a shopping hint, not a spec. */
export function estimateYarn({ stitches, rows, stitchLengthCm = 0.9, colorShare = 1 }) {
  const totalCm = stitches * rows * stitchLengthCm * colorShare;
  return {
    meters: Math.ceil(totalCm / 100),
    yards: Math.ceil(totalCm / 100 / 0.9144),
  };
}

/** Per-slot share of the panel, so yardage can be split across colors. */
export function colorShares(panelBitmap, slotCount) {
  const counts = new Array(slotCount).fill(0);
  for (let i = 0; i < panelBitmap.data.length; i++) {
    const v = panelBitmap.data[i];
    if (v < slotCount) counts[v]++;
  }
  const total = panelBitmap.data.length || 1;
  return counts.map((c) => c / total);
}
