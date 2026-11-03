/**
 * The single source of truth.
 *
 * Everything that changes the document goes through `commit()`, which takes a
 * history snapshot, runs the mutation, marks the project dirty and announces it
 * on the bus. Panels re-render from the event; nothing reaches into another
 * module's DOM (CLAUDE.md 5).
 *
 * UI-only state (selected tool, zoom, which panel is open) lives here too but
 * changes through `setUI()`, which does not touch history — undoing a brush
 * stroke should not also change your zoom level.
 */

import { emit } from './bus.js';
import { createHistory } from './history.js';
import * as Project from '../model/project.js';
import { validateProject } from '../model/validate.js';

export const state = {
  /** The document. */
  project: Project.createProject(),

  /** Editing state. */
  tool: 'pencil',
  shape: 'ellipse',
  shapeFilled: true,
  primary: 1,
  secondary: 0,
  /**
   * Which grid the tools paint: 'color' (palette indices) or 'stitches'
   * (model/stitch.js ops). The stitch layer paints `stitchOp`, and knit with
   * the right button or the eraser.
   */
  layer: 'color',
  stitchOp: 1,
  brushSize: 1,
  /** 'none' | 'x' | 'y' | 'xy' - mirrors every stroke about the tile center. */
  symmetry: 'none',
  selection: null, // {x, y, w, h} in tile coordinates
  activeStamp: null,
  stampTransform: { flipX: false, flipY: false, rotate: 0 },
  stampTransparent: true,
  /** Carry a stamp over the tile's edge onto the opposite side (bitmap.blit). */
  stampWrap: false,
  shapeOptions: {},
  /** Gradient tool: editor/gradient.js GRADIENT_SHAPES and DITHERS ids. */
  gradientShape: 'linear',
  gradientDither: 'bayer4',

  /**
   * Text tool. The string is not part of the document - once placed it is
   * stitches - so it lives here with the other editing settings.
   * Bold is the default because a stroke thinner than a stitch disappears when
   * the antialiased edge is thresholded, and `textGauge` is on because text is
   * where the stitch aspect shows worst (editor/text.js).
   */
  text: 'KNIT',
  textFont: 'system-ui, sans-serif',
  textSize: 12,
  textBold: true,
  textItalic: false,
  textSpacing: 0,
  textGauge: true,

  /** Held space temporarily turns any tool into a pan handle. */
  spaceDown: false,

  /** View state. */
  showGrid: true,
  gridMajor: 5,
  showRulers: true,
  showPanelGhost: true,
  showRepeatMarks: true,
  /** The tool options strip above the grid. Off gives the row back to the canvas. */
  showOptionsBar: true,
  previewMode: 'knit', // 'knit' | 'chart' | 'structure'
  /** Structure preview: 'front' (knit side) or 'back' (purl side, floats). */
  previewSide: 'front',

  /** Cached derived data. */
  validation: null,

  /** Library data loaded from the API. */
  yarns: [],
  stamps: [],
  gauges: [],
  projects: [],

  /** Housekeeping. */
  dirty: false,
  saving: false,
  lastSavedAt: null,
};

export const history = createHistory({
  snapshot: () => Project.serialize(state.project),
  restore: (doc) => {
    const id = state.project.id;
    state.project = Project.deserialize(doc);
    state.project.id = id;
    state.selection = null;
    invalidate();
    emit('project:changed', { reason: 'history' });
  },
});

// --- mutation ---------------------------------------------------------------

/**
 * Mutate the document.
 * @param {string} label shown in the undo tooltip
 * @param {(project: object) => void|false} fn return false to cancel the commit
 */
export function commit(label, fn) {
  history.push(label);
  const result = fn(state.project);
  if (result === false) {
    // Nothing actually changed; drop the restore point we just made.
    history.undo();
    return false;
  }
  state.dirty = true;
  invalidate();
  emit('project:changed', { reason: label });
  return true;
}

/**
 * For live drag previews: mutates and redraws without touching history.
 * The tool takes its own snapshot on pointer-down and commits on pointer-up.
 */
export function touch(reason = 'preview') {
  invalidate();
  emit('project:changed', { reason, transient: true });
}

// --- gestures ---------------------------------------------------------------
// A pointer drag is one undo step. The snapshot is taken when the gesture
// starts, the tool mutates freely while the pointer is down, and the whole
// thing lands in history on release.

let pendingSnapshot = null;

export function beginStroke() {
  pendingSnapshot = Project.serialize(state.project);
}

export function endStroke(label = 'draw') {
  if (!pendingSnapshot) return false;
  const before = pendingSnapshot;
  pendingSnapshot = null;
  history.pushSnapshot(label, before);
  state.dirty = true;
  invalidate();
  emit('project:changed', { reason: label });
  return true;
}

/** Abandon a gesture, putting the document back as it was. */
export function cancelStroke() {
  if (!pendingSnapshot) return false;
  const id = state.project.id;
  state.project = Project.deserialize(pendingSnapshot);
  state.project.id = id;
  pendingSnapshot = null;
  invalidate();
  emit('project:changed', { reason: 'cancel' });
  return true;
}

export function strokeInProgress() {
  return pendingSnapshot !== null;
}

export function setUI(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (changed) emit('ui:changed', patch);
  return changed;
}

export function replaceProject(project, { keepHistory = false } = {}) {
  state.project = project;
  state.selection = null;
  state.dirty = false;
  if (!keepHistory) history.clear();
  invalidate();
  emit('project:changed', { reason: 'load' });
}

export function setLibrary(key, rows) {
  state[key] = rows;
  emit('library:changed', { key, rows });
}

// --- derived ----------------------------------------------------------------

let validationDirty = true;

function invalidate() {
  validationDirty = true;
}

/**
 * Validation runs over the whole expanded panel, so it is the one genuinely
 * expensive derived value. Compute it lazily and cache until the next change.
 */
export function validation() {
  if (validationDirty || state.validation === null) {
    state.validation = validateProject(state.project);
    validationDirty = false;
  }
  return state.validation;
}
