/**
 * Kabmo service worker.
 *
 * Two jobs, and only the first one is about installability.
 *
 * 1. Chromium requires a fetch handler for PWA installability.
 *
 * 2. The dev client bundle is cached here rather than by the HTTP cache,
 *    because the HTTP cache CANNOT hold it. Chrome declines to store a response
 *    whose decoded body reaches ~5 MB — measured with `Cache-Control: no-cache`
 *    and a working `ETag`: 1 MB and 4 MB answered `304` on the next load, while
 *    5, 6, 7, 8, 16 and 20 MB were re-fetched in full every time, never sending
 *    `If-None-Match`. Bun's development bundle is ~19.7 MB (unminified, by
 *    design), so it was re-downloaded on every single page load — the whole of
 *    the dev-mode bandwidth complaint. Cache Storage has no such per-entry
 *    limit, so this is the one layer that can hold it.
 *
 * Only `/_dev-assets/client/*` is cached: that is the bundle, whose filename
 * carries a build-generation hash that changes on every rebuild, so a URL is a
 * reliable key for its bytes. `/_dev-assets/asset/*` is deliberately NOT
 * cached — a CSS asset keeps its name while its content changes (appending a
 * rule to `tailwind.css` changes the bytes served at the same URL), so
 * cache-first there would serve stale styles; those go to the network and are
 * revalidated by the server's own `ETag`, which answers `304`.
 *
 * One bundle generation is kept at a time: storing a new one drops the rest, so
 * the cache cannot grow by one bundle per rebuild. Nothing here runs in
 * production — the URLs it matches do not exist there.
 */

const BUNDLE_CACHE = 'kabmo-dev-bundle';

/** The cache this worker used before the rename. */
const LEGACY_BUNDLE_CACHE = 'ompchamber-dev-bundle';
const BUNDLE_PREFIX = '/_dev-assets/client/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The pre-rename cache holds a whole development bundle and nothing will
      // ever read it again — the key it was stored under is gone. Dropping it
      // here is the only thing that can reclaim those bytes on a client that
      // was already running when the worker changed.
      await caches.delete(LEGACY_BUNDLE_CACHE);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BUNDLE_PREFIX)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(BUNDLE_CACHE);
      const hit = await cache.match(url.pathname);
      if (hit) return hit;

      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(url.pathname, response.clone());
        // The previous generation is dead the moment a new one is stored.
        const stale = await cache.keys();
        await Promise.all(stale.filter((key) => new URL(key.url).pathname !== url.pathname).map((key) => cache.delete(key)));
      }
      return response;
    })(),
  );
});
