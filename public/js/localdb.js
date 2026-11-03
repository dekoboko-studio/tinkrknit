/**
 * The library in the browser: IndexedDB behind the same five calls as the PHP
 * API (api.js), for servers whose `storage` is browser (src/Config.php).
 *
 * It answers the way src/Crud.php does, so nothing above api.js can tell the
 * two apart: only whitelisted columns are written, list rows leave out the
 * big columns, `q`, `archived` and `limit` filter the same, ids count up from
 * 1, and times are SQLite's `datetime('now')` text (UTC, a space, no zone)
 * because parseDbTime() in ui/projectStore.js reads them. JSON columns are
 * stored as objects; IndexedDB clones on the way in and out, so a returned row
 * never aliases what the caller passed.
 *
 * Mirror any change to schema.sql or src/Resources.php in TABLES below.
 *
 * Also a small key-value store, `meta`, for things that must survive a reload
 * and cannot go in localStorage, such as the backup folder's handle
 * (ui/backup.js). It works in either storage mode.
 */

const DB_NAME = 'tinkrknit';
const DB_VERSION = 1;

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
const newest = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : b.id - a.id);

/** cols: writable; omit: left out of list rows; defaults: schema.sql's DEFAULTs. */
const TABLES = {
  projects: {
    cols: ['name', 'machine', 'tile_w', 'tile_h', 'panel_w', 'panel_h', 'doc', 'thumbnail'],
    omit: ['doc'],
    defaults: { machine: 'sk840', tile_w: 24, tile_h: 24, panel_w: 120, panel_h: 160, thumbnail: null },
    updated: true,
    order: newest('updated_at'),
  },
  yarns: {
    cols: ['name', 'brand', 'color', 'fiber', 'weight', 'grams', 'notes', 'archived'],
    omit: [],
    defaults: { brand: '', fiber: '', weight: '', grams: 0, notes: '', archived: 0 },
    order: byName,
  },
  palettes: {
    cols: ['name', 'slots'],
    omit: [],
    defaults: {},
    order: newest('created_at'),
  },
  stamps: {
    cols: ['name', 'tags', 'w', 'h', 'cells', 'colors'],
    omit: [],
    defaults: { tags: '', colors: [] },
    order: byName,
  },
  gauges: {
    cols: ['name', 'yarn_note', 'tension', 'sts_per_10cm', 'rows_per_10cm'],
    omit: [],
    defaults: { yarn_note: '', tension: '' },
    order: byName,
  },
};

export const LOCAL_RESOURCES = Object.keys(TABLES);

/** SQLite's datetime('now'): "2026-11-01 16:32:05", UTC. */
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser cannot store a library (no IndexedDB).'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of LOCAL_RESOURCES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        }
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab holds an older version open; it will close on its next load.
    request.onblocked = () => reject(new Error('Close other TinkrkniT tabs and reload.'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}

/** Run `work(store)` in one transaction; resolves with its request's result. */
async function run(storeName, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = work(tx.objectStore(storeName));
    let result;
    // A listener, not onsuccess: `work` may have set its own handler.
    if (request) request.addEventListener('success', () => { result = request.result; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
  });
}

function table(resource) {
  const t = TABLES[resource];
  if (!t) throw new Error(`Unknown resource '${resource}'`);
  return t;
}

/** Keep only whitelisted columns, as Crud::encode does. */
function pick(t, data) {
  const out = {};
  for (const col of t.cols) if (data && col in data) out[col] = data[col];
  return out;
}

/**
 * The columns a create would store, defaults filled in. Restore compares rows
 * in this shape (ui/backup.js), so a backup row with a column missing or an
 * extra one still matches the same row in either storage.
 */
export function storedRow(resource, data) {
  const t = table(resource);
  return { ...t.defaults, ...pick(t, data) };
}

function listRow(t, row) {
  if (!t.omit.length) return row;
  const out = { ...row };
  for (const col of t.omit) delete out[col];
  return out;
}

const notFound = (resource, id) => new Error(`No ${resource} with id ${id}`);

export const localApi = {
  ping: async () => {
    await open();
    return { storage: 'browser', resources: LOCAL_RESOURCES };
  },

  async list(resource, params = {}) {
    const t = table(resource);
    let rows = await run(resource, 'readonly', (s) => s.getAll());

    if (params.q) {
      const q = String(params.q).toLowerCase();
      rows = rows.filter((r) => String(r.name).toLowerCase().includes(q));
    }
    if (params.archived !== undefined && params.archived !== '' && t.cols.includes('archived')) {
      rows = rows.filter((r) => Number(r.archived) === Number(params.archived));
    }
    const limit = params.limit ? Math.max(1, Math.min(500, Number(params.limit) | 0)) : 200;
    return rows.sort(t.order).slice(0, limit).map((r) => listRow(t, r));
  },

  async get(resource, id) {
    table(resource);
    const row = await run(resource, 'readonly', (s) => s.get(Number(id)));
    if (!row) throw notFound(resource, id);
    return row;
  },

  async create(resource, data) {
    const t = table(resource);
    if (!Object.keys(pick(t, data)).length) throw new Error('No writable fields supplied');
    const stamp = now();
    const row = { ...storedRow(resource, data), created_at: stamp };
    if (t.updated) row.updated_at = stamp;
    const id = await run(resource, 'readwrite', (s) => s.add(row));
    return this.get(resource, id);
  },

  async update(resource, id, data) {
    const t = table(resource);
    const key = Number(id);
    await run(resource, 'readwrite', (s) => {
      const request = s.get(key);
      request.onsuccess = () => {
        if (!request.result) return;
        const next = { ...request.result, ...pick(t, data) };
        if (t.updated) next.updated_at = now();
        s.put(next);
      };
      return null;
    });
    return this.get(resource, key);
  },

  async remove(resource, id) {
    table(resource);
    const key = Number(id);
    const existed = await run(resource, 'readwrite', (s) => {
      const request = s.getKey(key);
      request.onsuccess = () => {
        if (request.result !== undefined) s.delete(key);
      };
      return request;
    });
    return { deleted: existed !== undefined };
  },
};

/** Small key-value store beside the library, for either storage mode. */
export const meta = {
  get: (key) => run('meta', 'readonly', (s) => s.get(key)),
  set: (key, value) => run('meta', 'readwrite', (s) => s.put(value, key)),
  delete: (key) => run('meta', 'readwrite', (s) => s.delete(key)),
};
