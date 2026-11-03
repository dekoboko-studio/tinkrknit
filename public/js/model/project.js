/**
 * The project document.
 *
 *   tile   the grid you actually edit
 *   panel  the finished flat piece, in stitches and rows
 *
 * If the tile is smaller than the panel, the panel is the tile repeated. The
 * tiling rules here mirror silver-reed-write's `pattern.ts` (alignment plus
 * optional horizontal/vertical repeat) so the preview matches what that tool
 * will actually emit (CLAUDE.md 1.4).
 *
 * Vertical repeats stack upward from the cast-on edge: the tile's bottom row
 * lands on the panel's bottom row, which is how a knitter reads a chart.
 */

import * as bitmap from './bitmap.js';
import * as palette from './palette.js';
import { DEFAULT_TECHNIQUE, DEFAULT_JACQUARD_COLORS, DEFAULT_BACKING, DEFAULT_PASSES_PER_COLOR } from './technique.js';
import { stitchLayer } from './stitch.js';

export const DEFAULTS = {
  tileW: 24,
  tileH: 24,
  panelW: 120,
  panelH: 160,
  floatThreshold: 7,
  /** Passes a needle may tuck or slip in a row before the held loop is flagged. */
  maxTuck: 4,
  maxSlip: 4,
  gauge: { stsPer10: 30, rowsPer10: 40 },
};

export function createProject(opts = {}) {
  const {
    name = 'Untitled project',
    tileW = DEFAULTS.tileW,
    tileH = DEFAULTS.tileH,
    panelW = DEFAULTS.panelW,
    panelH = DEFAULTS.panelH,
  } = opts;

  return {
    id: null,
    name,
    /** model/technique.js - which rules the chart is checked against and how it knits. */
    technique: DEFAULT_TECHNIQUE,
    /** Jacquard only: the backing the knit screen starts from (it may override). */
    jacquardBacking: DEFAULT_BACKING,
    tile: bitmap.createBitmap(tileW, tileH, 0),
    /** Knit, tuck or slip per tile cell (model/stitch.js). Same size as the tile. */
    stitches: bitmap.createBitmap(tileW, tileH, 0),
    /** Settings for the one-color-per-pass techniques. */
    stitch: { passesPerColor: DEFAULT_PASSES_PER_COLOR, ribber: false },
    panel: { w: panelW, h: panelH },
    palette: palette.createPalette(),
    repeat: { horizontal: true, vertical: true, alignment: 'center' },
    gauge: { ...DEFAULTS.gauge },
    validation: {
      floatThreshold: DEFAULTS.floatThreshold,
      jacquardColors: DEFAULT_JACQUARD_COLORS,
      maxTuck: DEFAULTS.maxTuck,
      maxSlip: DEFAULTS.maxSlip,
    },
    snapToDivisors: false,
    notes: '',
    /**
     * The color drawing a stitch chart was made from ("Stitch chart from
     * colors"), so it can be put back: { tile, stitches, panel, technique,
     * rows }, `rows` being the passes each drawn row became, from the cast-on.
     * Null for a project drawn directly.
     */
    source: null,
    /** Reserved for crown shaping; deliberately unimplemented (CLAUDE.md 7). */
    shaping: null,
  };
}

// --- tiling -----------------------------------------------------------------

function xOffsetFor(project) {
  const { alignment } = project.repeat;
  const slack = project.panel.w - project.tile.w;
  if (alignment === 'left') return 0;
  if (alignment === 'right') return slack;
  return Math.floor(slack / 2);
}

/**
 * The palette index shown at panel coordinate (x, y).
 * Returns 0 (background) where a non-repeating tile does not reach.
 */
export function panelIndexAt(project, x, y) {
  return panelCellAt(project, project.tile, x, y);
}

/** The stitch-layer operation at panel coordinate (x, y); knit where the tile does not reach. */
export function panelOpAt(project, x, y) {
  return panelCellAt(project, stitchLayer(project), x, y);
}

/** One tile-sized layer, read at a panel coordinate through the repeat. */
function panelCellAt(project, layer, x, y) {
  const { panel, repeat } = project;
  const tile = layer;

  let tx = x - xOffsetFor(project);
  if (repeat.horizontal) {
    tx = ((tx % tile.w) + tile.w) % tile.w;
  } else if (tx < 0 || tx >= tile.w) {
    return 0;
  }

  // Measure from the cast-on edge so repeats grow upward.
  const fromBottom = panel.h - 1 - y;
  let ty;
  if (repeat.vertical) {
    ty = tile.h - 1 - (((fromBottom % tile.h) + tile.h) % tile.h);
  } else {
    if (fromBottom >= tile.h) return 0;
    ty = tile.h - 1 - fromBottom;
  }

  return tile.data[ty * tile.w + tx];
}

/**
 * Which tile row a given panel row is drawn from, or -1 where a non-repeating
 * tile does not reach. Lets the validator point at the row you can actually fix.
 */
export function tileRowFor(project, panelY) {
  const { tile, panel, repeat } = project;
  const fromBottom = panel.h - 1 - panelY;
  if (repeat.vertical) {
    return tile.h - 1 - (((fromBottom % tile.h) + tile.h) % tile.h);
  }
  return fromBottom >= tile.h ? -1 : tile.h - 1 - fromBottom;
}

/**
 * Materialize the whole panel. Used by the preview, validator and exporters.
 * @param {object} [layer] a tile-sized grid; the colors unless given the stitches
 */
export function expandPanel(project, layer = project.tile) {
  const { w, h } = project.panel;
  const out = bitmap.createBitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.data[y * w + x] = panelCellAt(project, layer, x, y);
    }
  }
  return out;
}

/** The stitch layer across the whole panel. */
export const expandStitches = (project) => expandPanel(project, stitchLayer(project));

/** One panel row, written into `target` to avoid churning allocations. */
export function panelRow(project, y, target) {
  const w = project.panel.w;
  const out = target ?? new Uint8Array(w);
  for (let x = 0; x < w; x++) out[x] = panelIndexAt(project, x, y);
  return out;
}

// --- editing operations -----------------------------------------------------

export function resizeTile(project, w, h, anchor = 'bottom-left') {
  project.stitches = bitmap.resize(stitchLayer(project), w, h, { anchor });
  project.tile = bitmap.resize(project.tile, w, h, { anchor });
  return project;
}

export function resizePanel(project, w, h) {
  project.panel = { w: Math.max(1, w | 0), h: Math.max(1, h | 0) };
  return project;
}

export function addColorSlot(project, color, name) {
  return palette.addSlot(project.palette, color, name);
}

/**
 * Remove a slot and remap the grid so nothing points at a hole.
 * Cells using the removed slot fall back to slot 0; higher indices shift down.
 */
export function removeColorSlot(project, index) {
  if (project.palette.length <= 2) return false;
  if (index < 0 || index >= project.palette.length) return false;

  const table = [];
  for (let i = 0; i < 256; i++) {
    table[i] = i === index ? 0 : i > index ? i - 1 : i;
  }
  project.palette.splice(index, 1);
  bitmap.remapIndices(project.tile, table);
  return true;
}

/** Divisors of n, for snapping tile sizes so repeats land evenly. */
export function divisors(n) {
  const out = [];
  for (let i = 1; i <= n; i++) if (n % i === 0) out.push(i);
  return out;
}

export function nearestDivisor(n, target) {
  return divisors(n).reduce(
    (best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best),
    1
  );
}

// --- persistence ------------------------------------------------------------

export const DOC_VERSION = 1;

export function serialize(project) {
  return {
    version: DOC_VERSION,
    name: project.name,
    technique: project.technique,
    jacquardBacking: project.jacquardBacking,
    tile: bitmap.toJSON(project.tile),
    stitches: bitmap.toJSON(stitchLayer(project)),
    stitch: { ...project.stitch },
    panel: { ...project.panel },
    palette: palette.serialize(project.palette),
    repeat: { ...project.repeat },
    gauge: { ...project.gauge },
    validation: { ...project.validation },
    snapToDivisors: project.snapToDivisors,
    notes: project.notes,
    shaping: project.shaping,
    source: project.source && {
      tile: bitmap.toJSON(project.source.tile),
      stitches: bitmap.toJSON(project.source.stitches),
      panel: { ...project.source.panel },
      technique: project.source.technique,
      rows: [...project.source.rows],
    },
  };
}

/**
 * Every older version must keep loading: designs live in browsers, backups and
 * downloaded files where no migration can reach them. A newer one is refused
 * rather than half-read, which would drop whatever it added on the next save.
 */
export function deserialize(doc) {
  if (!doc || typeof doc !== 'object') return createProject();
  if (Number(doc.version) > DOC_VERSION) {
    throw new Error(
      `This design was made with a newer version of TinkrkniT (format ${doc.version}). ` +
        'Update this copy to open it.'
    );
  }

  const project = createProject({
    // `doc.machine` in older files is ignored: a design is machine agnostic,
    // and the machine is chosen on the knit screen.
    name: doc.name ?? 'Untitled project',
  });

  if (doc.technique) project.technique = doc.technique;
  if (doc.jacquardBacking) project.jacquardBacking = doc.jacquardBacking;
  if (doc.tile) project.tile = bitmap.fromJSON(doc.tile);
  // Documents from before the stitch layer have none; stitchLayer() makes an
  // all-knit one the size of the tile, and resizes one that no longer fits.
  project.stitches = doc.stitches ? bitmap.fromJSON(doc.stitches) : null;
  stitchLayer(project);
  Object.assign(project.stitch, doc.stitch ?? {});
  if (doc.panel) project.panel = { w: doc.panel.w, h: doc.panel.h };
  project.palette = palette.deserialize(doc.palette);
  Object.assign(project.repeat, doc.repeat ?? {});
  Object.assign(project.gauge, doc.gauge ?? {});
  Object.assign(project.validation, doc.validation ?? {});
  project.snapToDivisors = Boolean(doc.snapToDivisors);
  project.notes = doc.notes ?? '';
  project.shaping = doc.shaping ?? null;
  project.source = doc.source
    ? {
        tile: bitmap.fromJSON(doc.source.tile),
        stitches: bitmap.fromJSON(doc.source.stitches),
        panel: { ...doc.source.panel },
        technique: doc.source.technique,
        rows: [...(doc.source.rows ?? [])],
      }
    : null;

  return project;
}
