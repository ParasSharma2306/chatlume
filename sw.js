const CACHE_NAME = 'chatlume-v1.3.2';
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
    'js/instagram.js',
    'js/export.js',
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
    event.waitUntil(self.clients.claim());
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch: Network First for HTML, Stale-While-Revalidate for CSS/JS/Assets
self.addEventListener('fetch', (event) => {
    const request = event.request;
    
    // Use Network First for all HTML pages so updates propagate
    if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
        event.respondWith(
            fetch(request).catch(() => caches.match(request).then(cached => cached || caches.match('public/viewer.html')))
        );
        return;
    }

    // Use Stale-While-Revalidate for everything else
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
                }
                return networkResponse;
            }).catch(() => {}); // Ignore if offline
            
            return cachedResponse || fetchPromise;
        })
    );
});
