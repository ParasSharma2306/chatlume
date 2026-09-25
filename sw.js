const CACHE_NAME = 'chatlume-v1.7.3';
const OFFLINE_FALLBACK = 'index.html';
// Scripts, modules and styles are addressed with a release token (`?v=`).
// A page from one release therefore only ever asks for that release's files,
// and a token URL never changes content, so those entries are cache-first.
// The token must match the one in the HTML/JS — tests/release-version.test.mjs
// checks this, and scripts/bump-version.mjs updates it.
const ASSET_VERSION = CACHE_NAME.replace(/^chatlume-v/, '');
const versioned = (path) => `${path}?v=${ASSET_VERSION}`;
const ASSETS_TO_CACHE = [
    './',
    'index.html',
    'privacy.html',
    'sponsors.html',
    'sponsors.json',
    'public/viewer.html',
    'public/instagram-viewer.html',
    'public/how-it-works.html',
    'public/how-to-use.html',
    'public/how-to-export.html',
    'public/how-to-export-instagram.html',
    versioned('css/style.css'),
    versioned('js/export.js'),
    versioned('js/instagram.js'),
    versioned('js/instagram/media.js'),
    versioned('js/instagram/mojibake.js'),
    versioned('js/instagram/parser.js'),
    versioned('js/instagram/render.js'),
    versioned('js/instagram/search.js'),
    versioned('js/instagram/session.js'),
    versioned('js/instagram/state.js'),
    versioned('js/instagram/threads.js'),
    versioned('js/instagram/ui.js'),
    versioned('js/script.js'),
    versioned('js/settings.js'),
    versioned('js/shared/colors.js'),
    versioned('js/shared/compat.js'),
    versioned('js/shared/dom.js'),
    versioned('js/shared/drop-zone.js'),
    versioned('js/shared/emoji.js'),
    versioned('js/shared/history.js'),
    versioned('js/shared/lazy-media.js'),
    versioned('js/shared/media-modal.js'),
    versioned('js/shared/media-types.js'),
    versioned('js/shared/media-urls.js'),
    versioned('js/shared/safe-storage.js'),
    versioned('js/shared/splash.js'),
    versioned('js/shared/stats-panel.js'),
    versioned('js/shared/text.js'),
    versioned('js/shared/theme.js'),
    versioned('js/shared/toast.js'),
    versioned('js/shared/virtual-list.js'),
    versioned('js/site.js'),
    versioned('js/sponsors.js'),
    versioned('js/storage-worker.js'),
    versioned('js/storage.js'),
    versioned('js/support.js'),
    versioned('js/whatsapp-parser.js'),
    versioned('js/whatsapp/date-jump.js'),
    versioned('js/whatsapp/file-picker.js'),
    versioned('js/whatsapp/filter.js'),
    versioned('js/whatsapp/format.js'),
    versioned('js/whatsapp/media.js'),
    versioned('js/whatsapp/parser.js'),
    versioned('js/whatsapp/persistence.js'),
    versioned('js/whatsapp/render.js'),
    versioned('js/whatsapp/search.js'),
    versioned('js/whatsapp/session.js'),
    versioned('js/whatsapp/settings-store.js'),
    versioned('js/whatsapp/settings-ui.js'),
    versioned('js/whatsapp/state.js'),
    versioned('js/whatsapp/stats.js'),
    versioned('js/whatsapp/ui.js'),
    versioned('js/whatsapp/wrapped.js'),
    'manifest.json',
    'robots.txt',
    'sitemap.xml',
    'assets/favicon.ico',
    'assets/logo.png',
    'assets/logo-192.png',
    'assets/logo-64.png',
    'assets/logo-32.png',
    'assets/apple-touch-icon.png',
    'assets/avatar-placeholder.svg',
    'assets/maskable-192.png',
    'assets/maskable-512.png',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/og-image.png',
    'assets/brag-poster.jpg'
];

// Install: cache core assets. The new worker then *waits* until the page asks
// it to take over (see the message handler) or every tab has closed. Taking
// over immediately used to swap the cache underneath open pages, so a viewer
// that lazily started the storage worker could get a newer worker than the
// storage.js it was talking to.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // cache.addAll() rejects the whole install if a single entry 404s,
            // which would leave the app with no offline cache at all. Add each
            // asset independently so one missing file can't take out the rest.
            return Promise.all(
                ASSETS_TO_CACHE.map((asset) => cache.add(asset).catch(() => {}))
            );
        })
    );
});

// The page shows an "update available" prompt (js/site.js) and sends this
// once the user chooses to reload, so the swap happens on a fresh page load.
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Activate: Cleanup old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName !== CACHE_NAME)
                    .map((cacheName) => caches.delete(cacheName))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: Network First for page navigations, Cache First for release-tagged
// assets, Stale-While-Revalidate for everything else (images, manifest, …)
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only GET is cacheable; anything else goes straight to the network.
    if (request.method !== 'GET') return;

    // Range requests and dynamic/large exports go straight to the network.
    if (request.headers.has('range')) return;

    const url = new URL(request.url);
    if (url.pathname.endsWith('/config.json') || url.pathname.endsWith('.zip')) return;

    if (isNavigation(request)) {
        event.respondWith(handleNavigation(request));
        return;
    }

    if (isVersionedAsset(request)) {
        event.respondWith(handleVersionedAsset(request));
        return;
    }

    event.respondWith(handleAsset(request));
});

/** Same-origin script/style URLs carrying the release token. */
function isVersionedAsset(request) {
    const url = new URL(request.url);
    return url.origin === self.location.origin && /^\d+\.\d+\.\d+$/.test(url.searchParams.get('v') || '');
}

/**
 * Page loads. Requests routed by `Accept: text/html` also caught things like
 * prefetches, so this keys off the navigation mode instead (with the Accept
 * header as a fallback for browsers that don't set `mode`).
 */
function isNavigation(request) {
    if (request.mode === 'navigate') return true;
    const accept = request.headers.get('Accept') || '';
    return request.destination === 'document' && accept.includes('text/html');
}

/**
 * Network first, so a deployed change shows up immediately. Successful pages
 * are written back to the cache — previously only the install-time copies were
 * ever available offline, so an updated page still served its original markup.
 * Offline, the page itself is served from cache; a page that was never visited
 * falls back to the landing page rather than to the WhatsApp viewer, which used
 * to appear in place of every unreachable URL.
 */
async function handleNavigation(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
    } catch (error) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        const fallback = await caches.match(OFFLINE_FALLBACK);
        if (fallback) return fallback;

        return new Response(
            '<!DOCTYPE html><meta charset="utf-8"><title>Offline</title>' +
            '<body style="font-family:system-ui,sans-serif;background:#0b141a;color:#e9edef;' +
            'display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
            '<div><h1>You\'re offline</h1><p>Reconnect and reload to open ChatLume.</p></div>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }
}

/**
 * Cache first. The token in the URL changes with every release, so a cached
 * copy can never be stale — and revalidating it would be actively harmful:
 * the server ignores the query string, so a background refetch of
 * a release-tagged `storage.js` after the 1.6.1 deploy would silently overwrite the
 * 1.6.0 module with 1.6.1 code under the old key.
 */
async function handleVersionedAsset(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
    } catch (error) {
        return new Response('', { status: 504, statusText: 'Offline' });
    }
}

/** Stale-while-revalidate for images and other untagged assets: instant paint, refreshed in the background. */
async function handleAsset(request) {
    const cached = await caches.match(request);

    const network = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
    }).catch(() => cached);

    const response = cached || await network;

    // An uncached asset requested while offline resolved to `undefined`, and
    // respondWith(undefined) rejects with a TypeError — which surfaces as a
    // confusing script error instead of a plain failed request.
    return response || new Response('', { status: 504, statusText: 'Offline' });
}
