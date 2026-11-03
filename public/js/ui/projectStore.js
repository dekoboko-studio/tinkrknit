/**
 * Saving and loading projects.
 *
 * The whole document goes into one JSON column. That keeps the schema stable
 * while the document format keeps growing - adding shaping or a second panel
 * later is a document change, not a migration (CLAUDE.md 3.1). The indexed
 * columns alongside it exist only so the browser list can be rendered without
 * parsing every document.
 */

import { api } from '../api.js';
import { state, replaceProject, setLibrary } from '../core/store.js';
import { serialize, deserialize, createProject, expandPanel } from '../model/project.js';
import { emit } from '../core/bus.js';

/** A small color thumbnail for the project list. */
function thumbnail(project, maxPx = 96) {
  const grid = expandPanel(project);
  const scale = Math.min(1, maxPx / Math.max(grid.w, grid.h));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(grid.w * scale));
  canvas.height = Math.max(1, Math.round(grid.h * scale));

  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);

  const rgb = project.palette.map((slot) => {
    const n = parseInt(slot.color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const sx = Math.min(grid.w - 1, Math.floor(x / scale));
      const sy = Math.min(grid.h - 1, Math.floor(y / scale));
      const [r, g, b] = rgb[grid.data[sy * grid.w + sx]] ?? [128, 128, 128];
      const i = (y * canvas.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function toRow(project) {
  return {
    name: project.name,
    tile_w: project.tile.w,
    tile_h: project.tile.h,
    panel_w: project.panel.w,
    panel_h: project.panel.h,
    doc: serialize(project),
    thumbnail: thumbnail(project),
  };
}

/**
 * When each project was last used here, opened or saved, by id.
 *
 * `updated_at` only moves on a save, so a project you open every day to knit
 * from but never change would sink to the bottom of a list sorted by it. This
 * is per browser, like the dock layout; the server keeps only what the
 * document is, not who looked at it.
 */
const RECENT_KEY = 'knit-designer:recent-projects';

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? {};
  } catch {
    return {};
  }
}

function writeRecent(map) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(map));
  } catch {
    // Storage full or blocked: recents fall back to the edit date.
  }
}

function touchRecent(id) {
  writeRecent({ ...readRecent(), [id]: Date.now() });
}

/** SQLite's `datetime('now')` is UTC with a space and no zone marker. */
export function parseDbTime(text) {
  return text ? new Date(`${text.replace(' ', 'T')}Z`) : null;
}

/** Last opened or saved, whichever is later, in ms. */
export function lastUsed(row) {
  const opened = readRecent()[row.id] ?? 0;
  const edited = parseDbTime(row.updated_at)?.getTime() ?? 0;
  return Math.max(opened, edited);
}

/** The library ordered by `lastUsed`, newest first. */
export function recentProjects(rows = state.projects ?? [], limit = Infinity) {
  return [...rows].sort((a, b) => lastUsed(b) - lastUsed(a)).slice(0, limit);
}

/** Asked before anything replaces the open document. */
export function confirmDiscard() {
  return !state.dirty || confirm('The open project has unsaved changes. Discard them?');
}

export async function listProjects() {
  // The browser dialog filters this list client-side, so ask for the
  // server's ceiling rather than its default page.
  const rows = await api.list('projects', { limit: 500 });
  setLibrary('projects', rows);
  return rows;
}

/** Save the open project, inserting on first save and updating after that. */
export async function saveProject({ asNew = false } = {}) {
  if (state.saving) return null;
  state.saving = true;
  emit('save:changed', { saving: true });

  try {
    const project = state.project;
    const row = toRow(project);

    if (asNew || !project.id) {
      const created = await api.create('projects', row);
      project.id = created.id;
    } else {
      await api.update('projects', project.id, row);
    }

    state.dirty = false;
    state.lastSavedAt = new Date();
    touchRecent(project.id);
    await listProjects();
    return project.id;
  } finally {
    state.saving = false;
    emit('save:changed', { saving: false });
  }
}

export async function openProject(id) {
  const row = await api.get('projects', id);
  const project = deserialize(row.doc);
  project.id = row.id;
  replaceProject(project);
  touchRecent(row.id);
  return project;
}

export async function deleteProject(id) {
  await api.remove('projects', id);
  const recent = readRecent();
  delete recent[id];
  writeRecent(recent);
  if (state.project.id === id) state.project.id = null;
  await listProjects();
}

export function newProject(opts = {}) {
  replaceProject(createProject(opts));
}

/**
 * Import a .knitproj file exported from this tool, or one double-clicked in
 * the OS once the app is installed (pwa.js). Older exports are .knitproj.json;
 * the contents are the same.
 */
export async function importProjectFile(file) {
  const text = await file.text();
  const project = deserialize(JSON.parse(text));
  project.id = null; // an import is a new project, never an overwrite
  replaceProject(project);
  return project;
}
