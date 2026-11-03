/**
 * Library backup: every project, stamp and yarn in one file.
 *
 * In browser storage (api.js) the library lives in one browser profile, which
 * the browser may clear - Safari after a week unvisited, Chrome when asked on
 * uninstall - so a copy outside it is the only safety net. Two ways out:
 *
 *   - Download: one file to Downloads, any browser, by hand.
 *   - Folder (Chrome, Edge): pick a folder once and the backup is rewritten
 *     there after changes, at most every few minutes, one dated file a day,
 *     the last KEEP_DAYS kept. A folder inside OneDrive, Dropbox or iCloud
 *     makes that an off-site copy with no accounts here.
 *
 * Restore merges: a row identical to one already in the library (ignoring
 * ids, times and thumbnails) is skipped, so restoring twice adds nothing.
 * Everything goes through api.js, so this works in server storage too, and a
 * backup moves a library between copies of the app either way.
 */

import { api, STORAGE } from '../api.js';
import { meta, storedRow } from '../localdb.js';
import { emit, on } from '../core/bus.js';
import { DOC_VERSION } from '../model/project.js';
import { APP_VERSION } from '../version.js';
import { downloadJSON } from '../export/png.js';
import { listProjects } from './projectStore.js';
import { loadYarns, loadStamps } from './library.js';

const FORMAT = 'tinkrknit-library';
const FORMAT_VERSION = 1;
const RESOURCES = ['projects', 'stamps', 'yarns', 'palettes', 'gauges'];
/** Stored, but not part of what a row *is*: compared without it on restore. */
const VOLATILE = new Set(['thumbnail']);

const FOLDER_KEY = 'backup-folder';
const LAST_KEY = 'knit-designer:last-backup';
const FILE_PATTERN = /^tinkrknit-library-\d{4}-\d{2}-\d{2}\.json$/;
const KEEP_DAYS = 7;
const QUIET_MS = 15_000;        // after a change, before writing
const MIN_GAP_MS = 3 * 60_000;  // between two folder writes

// --- the file ---------------------------------------------------------------

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fileName = () => `tinkrknit-library-${today()}.json`;

/** Full rows: a project's list row leaves out its document. */
async function allRows(resource) {
  const rows = await api.list(resource, { limit: 500 });
  return resource === 'projects'
    ? Promise.all(rows.map((row) => api.get('projects', row.id)))
    : rows;
}

export async function buildBackup() {
  const out = {
    format: FORMAT,
    version: FORMAT_VERSION,
    app: APP_VERSION,
    docVersion: DOC_VERSION,
    savedAt: new Date().toISOString(),
  };
  for (const resource of RESOURCES) out[resource] = await allRows(resource);
  return out;
}

/** JSON with sorted keys, so the same row compares equal whichever API wrote it. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A row as either API would store it (ids and times are not columns). */
function signature(resource, row) {
  const out = storedRow(resource, row);
  for (const key of VOLATILE) delete out[key];
  return canonical(out);
}

/** Merge a backup file into the library. Resolves with counts. */
export async function restoreBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not a TinkrkniT library backup.');
  }
  if (data?.format !== FORMAT) throw new Error('That file is not a TinkrkniT library backup.');
  if (Number(data.version) > FORMAT_VERSION) {
    throw new Error('That backup was made by a newer version of TinkrkniT. Update this copy to restore it.');
  }

  const result = { added: 0, skipped: 0, tooNew: 0 };
  for (const resource of RESOURCES) {
    const incoming = Array.isArray(data[resource]) ? data[resource] : [];
    if (!incoming.length) continue;
    const have = new Set((await allRows(resource)).map((row) => signature(resource, row)));
    for (const row of incoming) {
      if (resource === 'projects' && Number(row.doc?.version) > DOC_VERSION) {
        result.tooNew++;
        continue;
      }
      const sig = signature(resource, row);
      if (have.has(sig)) {
        result.skipped++;
        continue;
      }
      await api.create(resource, row);
      have.add(sig);
      result.added++;
    }
  }
  await Promise.allSettled([listProjects(), loadYarns(), loadStamps()]);
  return result;
}

// --- when it last happened --------------------------------------------------

export function lastBackup() {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null;
  } catch {
    return null;
  }
}

function markBackedUp() {
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the menu just cannot say when.
  }
  emit('backup:changed');
}

export async function downloadBackup() {
  downloadJSON(await buildBackup(), fileName());
  markBackedUp();
}

// --- folder backup ----------------------------------------------------------

export const folderSupported = () => 'showDirectoryPicker' in window;

const folder = {
  handle: null,
  /** none | ok | permission (asked again on a click) | error */
  state: 'none',
  error: '',
  lastWrite: 0,
  timer: null,
};

export function folderStatus() {
  return { name: folder.handle?.name ?? '', state: folder.state, error: folder.error };
}

function setFolderState(state, error = '') {
  folder.state = state;
  folder.error = error;
  emit('backup:changed');
}

async function prune(dir) {
  const names = [];
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file' && FILE_PATTERN.test(name)) names.push(name);
  }
  names.sort().reverse();
  for (const name of names.slice(KEEP_DAYS)) await dir.removeEntry(name);
}

async function writeFolder() {
  clearTimeout(folder.timer);
  folder.timer = null;
  const dir = folder.handle;
  if (!dir) return;

  if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    setFolderState('permission');
    return;
  }
  try {
    const text = JSON.stringify(await buildBackup());
    const file = await dir.getFileHandle(fileName(), { create: true });
    const writable = await file.createWritable();
    await writable.write(text);
    await writable.close();
    await prune(dir);
    folder.lastWrite = Date.now();
    folder.state = 'ok';
    folder.error = '';
    markBackedUp();
  } catch (error) {
    console.error(error);
    setFolderState('error', error.message);
  }
}

/** Write soon after a change; a write already pending covers later ones. */
function schedule() {
  if (!folder.handle || folder.timer) return;
  const wait = Math.max(QUIET_MS, folder.lastWrite + MIN_GAP_MS - Date.now());
  folder.timer = setTimeout(writeFolder, wait);
}

/** Ask for a folder. Resolves false if the picker was cancelled or the write failed. */
export async function chooseFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({
      id: 'tinkrknit-backup',
      mode: 'readwrite',
      startIn: 'documents',
    });
  } catch (error) {
    if (error.name === 'AbortError') return false;
    throw error;
  }
  await meta.set(FOLDER_KEY, handle);
  folder.handle = handle;
  await writeFolder();
  return folder.state === 'ok';
}

/**
 * Write now. After a reload the browser may want the folder confirmed, which
 * needs a click, so this is what the menu row calls. Resolves true if written.
 */
export async function resumeFolder() {
  if (!folder.handle) return false;
  if ((await folder.handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
    await writeFolder();
  } else {
    setFolderState('permission');
  }
  return folder.state === 'ok';
}

export async function stopFolder() {
  clearTimeout(folder.timer);
  folder.timer = null;
  folder.handle = null;
  await meta.delete(FOLDER_KEY);
  setFolderState('none');
}

/**
 * Call once the library has loaded, so loading it is not mistaken for a
 * change worth writing.
 */
export async function initBackup() {
  on('library:changed', schedule);
  // A pending write is lost with the page; start it now and hope it lands.
  addEventListener('pagehide', () => {
    if (folder.timer) writeFolder();
  });

  if (!folderSupported()) return;
  try {
    const handle = await meta.get(FOLDER_KEY);
    if (!handle) return;
    folder.handle = handle;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    setFolderState(permission === 'granted' ? 'ok' : 'permission');
  } catch (error) {
    console.error(error);
  }
}

/** For the File menu: "today", "yesterday", "12 days ago". */
export function backupAge(ms = lastBackup()) {
  if (!ms) return 'never';
  const days = Math.floor((startOfDay(Date.now()) - startOfDay(ms)) / 86_400_000);
  if (days <= 0) return `today ${new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** True when the library lives only in this browser. */
export const browserOnly = () => STORAGE === 'browser';
