/**
 * Service worker: lets the installed app open with no connection.
 *
 * Network first, cache as the fallback. Online, every load is the live site,
 * so an update reaches everyone on their next load with nothing to bump; the
 * cache only answers when the network does not. There is no precache list to
 * keep in step by hand (no build step, CLAUDE.md 2): the page posts the URLs
 * it loaded (js/pwa.js), which covers the first visit, before this worker was
 * in control, and every fetch after that refreshes its own entry.
 *
 * Entries are keyed without their query string, so the `?v=` cache busters in
 * index.php replace an entry instead of piling up a copy per version.
 *
 * Never cached: the API (a library must not be answered from a stale copy),
 * anything cross-origin, anything but GET.
 */

const CACHE = 'tinkrknit-v1';

const bare = (url) => {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
};

const cacheable = (url) => {
  const u = new URL(url);
  return u.origin === self.location.origin
    && u.href.startsWith(self.registration.scope)
    && !u.pathname.includes('/api/');
};

async function store(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(CACHE);
  await cache.put(bare(request.url ?? request), response);
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !cacheable(request.url)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      event.waitUntil(store(request, response.clone()));
      return response;
    } catch (error) {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(bare(request.url))
        // A navigation to any page in scope gets the app shell.
        ?? (request.mode === 'navigate' ? await cache.match(self.registration.scope) : undefined);
      if (hit) return hit;
      throw error;
    }
  })());
});

// The page sends what it loaded before this worker took control.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls') return;
  event.waitUntil((async () => {
    for (const url of event.data.urls) {
      if (!cacheable(url)) continue;
      const cache = await caches.open(CACHE);
      if (await cache.match(bare(url))) continue;
      try {
        await store(new Request(url), await fetch(url));
      } catch {
        // Offline already, or the file is gone; the next load fills it in.
      }
    }
  })());
});
