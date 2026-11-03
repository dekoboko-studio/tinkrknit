/**
 * What can be done with the selection, shared by the Select tool's options
 * bar, the Stamps panel and the keyboard (Ctrl+C / X / V, Delete).
 *
 * Copy keeps the area as a stamp record (editor/stamps.js), colors and all, so
 * Paste is simply the stamp tool with that record in hand: the same ghost,
 * drag to position, R to turn and arrows to nudge. The clipboard lives in this
 * page only, which is enough to move a motif between projects without saving
 * it to the library first.
 */

import { state, setUI, commit } from '../core/store.js';
import { emit } from '../core/bus.js';
import { captureFromSelection, materialize, toRow } from '../editor/stamps.js';
import { fillAll, crop } from '../model/bitmap.js';
import { stitchLayer } from '../model/stitch.js';
import { api } from '../api.js';
import { loadStamps } from './library.js';
import { toast } from './dom.js';

let clip = null;

export const hasClip = () => Boolean(clip);

/** Background (slot 1) over the selected stitches. */
function clearCells(p, sel) {
  for (let y = sel.y; y < sel.y + sel.h; y++) {
    for (let x = sel.x; x < sel.x + sel.w; x++) {
      if (x >= 0 && y >= 0 && x < p.tile.w && y < p.tile.h) p.tile.data[y * p.tile.w + x] = 0;
    }
  }
}

export async function saveSelectionAsStamp() {
  const sel = state.selection;
  if (!sel) return;
  const name = prompt('Stamp name', 'Motif');
  if (!name) return;
  try {
    await api.create('stamps', toRow(name, captureFromSelection(state.project, sel)));
    await loadStamps();
    toast('Stamp saved.', 'ok');
  } catch (error) {
    toast(error.message, 'error', 6000);
  }
}

export function copySelection() {
  const sel = state.selection;
  if (!sel) return false;
  clip = captureFromSelection(state.project, sel);
  // Nothing in the document changed, but Paste just became possible.
  emit('ui:changed', {});
  toast(`Copied ${sel.w} x ${sel.h}.`, 'ok', 1500);
  return true;
}

export function cutSelection() {
  const sel = state.selection;
  if (!sel) return false;
  clip = captureFromSelection(state.project, sel);
  commit('cut', (p) => clearCells(p, sel));
  return true;
}

/** The clipboard in hand as a stamp, the right way up. */
export function paste() {
  if (!clip) return false;
  setUI({
    activeStamp: { id: null, name: 'Pasted', record: clip, bitmap: materialize(clip, state.project.palette) },
    stampTransform: { flipX: false, flipY: false, rotate: 0 },
    layer: 'color',
    tool: 'stamp',
  });
  return true;
}

export function clearSelection() {
  const sel = state.selection;
  if (!sel) return false;
  commit('clear selection', (p) => clearCells(p, sel));
  return true;
}

export function cropToSelection() {
  const sel = state.selection;
  if (!sel) return;
  commit('crop tile', (p) => {
    p.stitches = crop(stitchLayer(p), sel.x, sel.y, sel.w, sel.h);
    p.tile = crop(p.tile, sel.x, sel.y, sel.w, sel.h);
  });
  setUI({ selection: null });
}

export function clearTile() {
  commit('clear tile', (p) => fillAll(state.layer === 'stitches' ? stitchLayer(p) : p.tile, 0));
}
