const CACHE_NAME = 'chatlume-v1.6.0';
const OFFLINE_FALLBACK = 'index.html';
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
    'css/style.css',
    'js/script.js',
    'js/storage.js',
    'js/storage-worker.js',
    'js/instagram.js',
    'js/export.js',
    'js/support.js',
    'js/site.js',
    'js/sponsors.js',
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
    'assets/og-image.png'
];

// Install: Cache core assets and immediately take control
self.addEventListener('install', (event) => {
    self.skipWaiting();
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

// Fetch: Network First for page navigations, Stale-While-Revalidate for assets
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only GET is cacheable; anything else goes straight to the network.
    if (request.method !== 'GET') return;

    if (isNavigation(request)) {
        event.respondWith(handleNavigation(request));
        return;
    }

    event.respondWith(handleAsset(request));
});

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

/** Stale-while-revalidate for CSS/JS/images: instant paint, refreshed in the background. */
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
