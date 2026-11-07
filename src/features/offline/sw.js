// src/features/offline/sw.js
// ─────────────────────────────────────────────────────────────────────────────
//  The service worker: keeps this version of the app on the device so it opens
//  without a connection. The build (offlineApp in vite.config.ts) writes it to
//  dist/sw.js with VERSION and APP_FILES filled in; offline.ts registers it.
//  Only this site's own files are kept; requests to other sites are left alone.
// ─────────────────────────────────────────────────────────────────────────────

// filled in by the build: this version's files, and a name that changes whenever any of them does
const VERSION = 'dev';
const APP_FILES = [];

const APP_CACHE = `tierinator-app-${VERSION}`;
// templates and packs, kept as they're used: the Pokémon pack is too big to download unasked
const DATA_CACHE = 'tierinator-data';

/** Downloads this version's files. One failure fails the install, so a half-kept version is never used. */
async function keepAppFiles() {
    const cache = await caches.open(APP_CACHE);
    await Promise.all(
        APP_FILES.map(async (path) => {
            // a hashed file an earlier version already kept is the same file: no need to download it again
            const earlier = path.startsWith('/assets/') && (await caches.match(path, { ignoreVary: true }));
            if (earlier) return cache.put(path, earlier);
            // straight from the server: the browser's own cache might hold a file from another version
            const response = await fetch(path, { cache: 'reload' });
            if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
            // the host sends /privacy.html on to /privacy, and a redirected answer can't be used for a page load
            const usable = response.redirected
                ? new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
                : response;
            await cache.put(path, usable);
        }),
    );
}

/**
 * Whether an answer is worth keeping. The host answers a missing address with the app's page (and 200), so a
 * page arriving for a script, style or data file means the file is gone, not that it's this.
 */
const isKeepable = (response) => response.ok && !(response.headers.get('content-type') || '').startsWith('text/html');

/** Removes the files of earlier versions, then looks after open pages at once (a first visit too). */
async function dropOldVersions() {
    for (const name of await caches.keys()) {
        if (name.startsWith('tierinator-') && name !== APP_CACHE && name !== DATA_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
}

/** How long a page waits for the network before the kept copy answers instead (a weak signal on a train). */
const PAGE_TIMEOUT_MS = 4000;

/**
 * Pages come from the network when it answers, so a new version is seen at once. Offline, or with no answer
 * within PAGE_TIMEOUT_MS, the kept copy of the page, or the app itself for any other address (as the host does).
 */
async function pageFromNetworkFirst(request, path) {
    const cache = await caches.open(APP_CACHE);
    const kept = async () => (await cache.match(path)) || (await cache.match(`${path}.html`)) || (await cache.match('/'));
    const network = fetch(request);
    network.catch(() => {}); // when the kept copy answers first, a later failure has nobody to tell
    const slow = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS, 'slow'));
    try {
        const first = await Promise.race([network, slow]);
        if (first !== 'slow') return first;
        return (await kept()) || (await network);
    } catch {
        return (await kept()) || Response.error();
    }
}

/** The kept copy if there is one. Files under /assets have their content's hash in the name, so a copy never goes stale. */
async function cacheFirst(request) {
    const cache = await caches.open(APP_CACHE);
    const kept = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (kept) return kept;
    const response = await fetch(request);
    if (isKeepable(response)) await cache.put(request, response.clone());
    return response;
}

/** Answers from the kept copy at once (if any) and refreshes it in the background for next time. */
async function staleWhileRevalidate(event, request) {
    const cache = await caches.open(DATA_CACHE);
    const kept = await cache.match(request, { ignoreVary: true });
    const fresh = fetch(request).then(async (response) => {
        if (isKeepable(response)) await cache.put(request, response.clone());
        return response;
    });
    if (!kept) return fresh;
    event.waitUntil(fresh.catch(() => {})); // offline, the kept copy simply stays
    return kept;
}

// ── wiring ──
// No skipWaiting here: a new version waits until the page's "Reload" button asks for it, so nobody's
// ranking is reloaded from under them.
self.addEventListener('install', (event) => event.waitUntil(keepAppFiles()));
self.addEventListener('activate', (event) => event.waitUntil(dropOldVersions()));

self.addEventListener('message', (event) => {
    if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    // other sites (pictures, searches, fonts) are never kept here: the app keeps pictures in its own storage
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (request.mode === 'navigate') event.respondWith(pageFromNetworkFirst(request, url.pathname));
    else if (url.pathname.startsWith('/assets/') || APP_FILES.includes(url.pathname)) event.respondWith(cacheFirst(request));
    else if (/^\/(templates|packs)\//.test(url.pathname)) event.respondWith(staleWhileRevalidate(event, request));
});
