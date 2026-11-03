/**
 * Text rasterization.
 *
 * Glyphs become stitches by drawing them to an offscreen canvas at exactly the
 * size they will be knitted and thresholding the result. There is no font
 * parsing and no bitmap font shipped with the app: the browser already has a
 * shaper and a rasterizer, and using it at 1 pixel per stitch is the whole job.
 *
 * Two things about knitting change how this is done.
 *
 * **Stitches are wider than they are tall.** `stitchAspect` is rows over
 * stitches per 10cm, around 1.33 in stockinette, and the chart is a square
 * grid, so a letter drawn at its natural proportions knits out a third too
 * wide. The text is therefore rendered horizontally compressed by 1/aspect,
 * which makes the chart look narrow and the fabric look right. It is optional,
 * because a motif meant to match a chart someone else drew wants the square
 * grid instead.
 *
 * **There is no gray.** A stitch takes one yarn or the other (CLAUDE.md 1.1),
 * so the antialiased edge the browser produces has to be thresholded. Coverage
 * at or above `threshold` becomes a stitch and everything else is background.
 * Rendering big and downsampling would only push more pixels through the same
 * decision, so the text is drawn at its final size and cut once.
 *
 * Results are cached by their settings, not by position, so the hover cursor
 * can outline the real footprint on every pointer move without re-shaping the
 * string forty times a second.
 */

/**
 * Families that ship with Windows, macOS or a typical desktop Linux, each with
 * a generic on the end so an unknown name still resolves to something. Heavy,
 * wide faces survive being cut to stitches best - at ten rows tall a hairline
 * serif loses whole strokes - so those lead.
 */
export const SYSTEM_FONTS = [
  ['system-ui, sans-serif', 'System sans'],
  ['Arial, Helvetica, sans-serif', 'Arial / Helvetica'],
  ['"Arial Black", "Arial Bold", Gadget, sans-serif', 'Arial Black'],
  ['Impact, Haettenschweiler, "Franklin Gothic Bold", sans-serif', 'Impact'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['Tahoma, Verdana, sans-serif', 'Tahoma'],
  ['"Trebuchet MS", "Lucida Grande", sans-serif', 'Trebuchet MS'],
  ['Georgia, "Times New Roman", serif', 'Georgia'],
  ['"Times New Roman", Times, serif', 'Times New Roman'],
  ['"Courier New", Courier, monospace', 'Courier New'],
  ['Consolas, "Lucida Console", monospace', 'Consolas'],
];

/** Ink height in rows. Below about 7 most faces lose their counters. */
export const MIN_ROWS = 3;
export const MAX_ROWS = 120;

/** Measured at this size first; font metrics are close enough to linear to scale. */
const PROBE = 100;

let scratch = null;

function context() {
  if (!scratch) {
    scratch = document.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
    });
  }
  return scratch;
}

function fontString({ family, bold, italic }, px) {
  return `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${px}px ${family}`;
}

const cache = new Map();
const CACHE_MAX = 24;

const EMPTY = { w: 0, h: 0, points: [] };

/**
 * Rasterize one line of text.
 *
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} opts.family    a CSS font stack from `SYSTEM_FONTS`
 * @param {number} opts.rows      ink height in rows; the bounding box of what
 *                                is actually drawn, not the font's em size, so
 *                                "12" means twelve rows of stitches
 * @param {boolean} [opts.bold]
 * @param {boolean} [opts.italic]
 * @param {number} [opts.spacing] extra stitches between letters
 * @param {number} [opts.aspect]  stitch width over height; 1 draws on the
 *                                square grid with no gauge correction
 * @param {number} [opts.threshold] coverage needed to make a stitch, 0-1
 * @returns {{w: number, h: number, points: Array<[number, number]>}}
 *   Points are relative to the top-left of the ink box.
 */
export function rasterizeText(opts) {
  const key = JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit;

  const result = render(opts);

  // Small and bounded: the settings only change when the user touches a
  // control, so a handful of entries covers every hover in between.
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

function render({
  text, family, rows, bold = false, italic = false,
  spacing = 0, aspect = 1, threshold = 0.5,
}) {
  const line = String(text ?? '').replace(/\s+$/, '');
  if (!line) return EMPTY;

  const ctx = context();
  const style = { family, bold, italic };

  // `letterSpacing` is a recent addition; where it is missing the assignment is
  // ignored and the text sets solid, which is a poor default rather than a bug.
  // It is in stitches, so it is compressed with everything else on the x axis.
  const setSpacing = () => {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * aspect}px`;
  };

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = fontString(style, PROBE);
  const probe = ctx.measureText(line);
  const probeInk = probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent;
  if (!(probeInk > 0)) return EMPTY;

  // Solve for the size that makes the ink exactly `rows` tall, then measure
  // again: hinting means the metrics are not perfectly linear, and the second
  // measurement is the one the canvas is sized from.
  const px = Math.max(1, (PROBE * rows) / probeInk);
  ctx.font = fontString(style, px);
  setSpacing();
  const m = ctx.measureText(line);

  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  if (!(inkW > 0) || !(inkH > 0)) return EMPTY;

  // Compressing the x axis is what corrects for the stitch aspect: the canvas
  // is the compressed size and the drawing is scaled into it.
  const w = Math.max(1, Math.ceil(inkW / aspect));
  const h = Math.max(1, Math.ceil(inkH));

  ctx.canvas.width = w;
  ctx.canvas.height = h;

  // Resizing a canvas resets its entire state, so all of it is set again here.
  ctx.font = fontString(style, px);
  setSpacing();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.setTransform(1 / aspect, 0, 0, 1, 0, 0);
  ctx.fillText(line, m.actualBoundingBoxLeft, m.actualBoundingBoxAscent);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const { data } = ctx.getImageData(0, 0, w, h);
  const cut = Math.round(Math.min(1, Math.max(0, threshold)) * 255);
  const points = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Drawn opaque white on transparent, so alpha is the coverage.
      if (data[(y * w + x) * 4 + 3] >= cut) points.push([x, y]);
    }
  }

  return points.length ? trimmed(points, w, h) : EMPTY;
}

/**
 * Thresholding can leave the outermost row or column empty: the glyph's ink box
 * includes coverage too faint to survive the cut. Trimming keeps the block
 * centered on the cursor over the stitches that actually exist, and makes `w`
 * and `h` a true stitch count to report in the options bar.
 */
function trimmed(points, w, h) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    points: points.map(([x, y]) => [x - minX, y - minY]),
  };
}
