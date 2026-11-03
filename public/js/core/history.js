/**
 * Undo/redo by whole-document snapshot.
 *
 * Snapshotting the entire serialized project rather than diffing individual
 * edits means palette changes, resizes and pixel strokes all undo correctly
 * with no per-operation bookkeeping. A tile is small; even a 200x200 panel
 * snapshot is around 50KB, so the memory cost of a bounded stack is fine.
 *
 * Call `push()` BEFORE mutating.
 */

import { emit } from './bus.js';

export function createHistory({ snapshot, restore, limit = 60 }) {
  let past = [];
  let future = [];

  function changed() {
    emit('history:changed', { canUndo: past.length > 0, canRedo: future.length > 0 });
  }

  return {
    /** Record the current state as a restore point, labeled for the UI. */
    push(label = 'edit') {
      past.push({ label, state: snapshot() });
      if (past.length > limit) past.shift();
      future = [];
      changed();
    },

    /**
     * Record a snapshot captured earlier. Drag tools grab one on pointer-down,
     * mutate live for the preview, then commit it here on pointer-up so the
     * whole gesture undoes as a single step.
     */
    pushSnapshot(label, state) {
      past.push({ label, state });
      if (past.length > limit) past.shift();
      future = [];
      changed();
    },

    undo() {
      const entry = past.pop();
      if (!entry) return null;
      future.push({ label: entry.label, state: snapshot() });
      restore(entry.state);
      changed();
      return entry.label;
    },

    redo() {
      const entry = future.pop();
      if (!entry) return null;
      past.push({ label: entry.label, state: snapshot() });
      restore(entry.state);
      changed();
      return entry.label;
    },

    clear() {
      past = [];
      future = [];
      changed();
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    nextUndoLabel: () => past.at(-1)?.label ?? null,
    nextRedoLabel: () => future.at(-1)?.label ?? null,
  };
}
