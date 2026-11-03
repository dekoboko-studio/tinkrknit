/**
 * The library's five calls - list, get, create, update, remove - and where
 * they go.
 *
 * The server decides that (src/Config.php) and says so in a meta tag written
 * by index.php: `server` sends them to the PHP front controller below,
 * `browser` (the default) keeps them in IndexedDB (localdb.js). Both answer
 * with the same rows, so nothing above this module knows which it is talking
 * to. There is no fallback from one to the other: a server that cannot be
 * reached is an error, not a reason to start a second library that drifts.
 *
 * Uses the `?r=` form rather than PATH_INFO so it works on any local server
 * without rewrite rules or `cgi.fix_pathinfo` tuning. Extra query parameters
 * are set as real search params so they never end up encoded into `r`.
 */

import { localApi } from './localdb.js';

/** 'server' or 'browser'. Anything else, or no tag at all, is browser. */
export const STORAGE =
  document.querySelector('meta[name="knit-storage"]')?.content === 'server' ? 'server' : 'browser';

const BASE = new URL('api/index.php', document.baseURI).href;

function url(path, params = {}) {
  const u = new URL(BASE);
  u.searchParams.set('r', path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      u.searchParams.set(key, String(value));
    }
  }
  return u.href;
}

async function request(path, { params, ...options } = {}) {
  let response;
  try {
    response = await fetch(url(path, params), {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (cause) {
    throw new Error(`Cannot reach the server. Is PHP running? (${cause.message})`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // A PHP warning or fatal usually lands here; surface it rather than
    // pretending the request merely "failed".
    throw new Error(`Server returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload.data;
}

const body = (data) => JSON.stringify(data);

const serverApi = {
  ping: () => request('ping'),
  list: (resource, params = {}) => request(resource, { params }),
  get: (resource, id) => request(`${resource}/${id}`),
  create: (resource, data) => request(resource, { method: 'POST', body: body(data) }),
  update: (resource, id, data) =>
    request(`${resource}/${id}`, { method: 'PUT', body: body(data) }),
  remove: (resource, id) => request(`${resource}/${id}`, { method: 'DELETE' }),
};

export const api = STORAGE === 'server' ? serverApi : localApi;
