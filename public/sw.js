const CACHE_NAME = 'codraw-cache-v1';

// Static resources to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/js/app.js',
  '/js/canvas.js',
  '/js/sync.js',
  '/js/ui.js',
  '/icon-192.png',
  '/icon-512.png'
];

// Install Event - Pre-cache critical app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Force the waiting service worker to become the active service worker
      return self.skipWaiting();
    })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim clients to make the active service worker take control of page immediately
      return self.clients.claim();
    })
  );
});

// Fetch Event - Cache first, fallback to network for static & CDN assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // We only intercept GET requests
  if (request.method !== 'GET') return;

  // For WebSockets or local signaling endpoints, do not intercept
  if (url.protocol === 'ws:' || url.protocol === 'wss:' || url.pathname.includes('/socket.io/')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached resource, but fetch in background to update cache (stale-while-revalidate style)
        // only if it's online
        if (navigator.onLine) {
          fetch(request).then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
            }
          }).catch(() => {/* Ignore network update errors */});
        }
        return cachedResponse;
      }

      // If not in cache, fetch from network and dynamically cache
      return fetch(request).then((networkResponse) => {
        // Only cache successful standard requests or CDN resources
        if (
          networkResponse.status === 200 &&
          (url.origin === self.location.origin ||
           url.hostname.includes('cdn') ||
           url.hostname.includes('esm.sh') ||
           url.hostname.includes('unpkg.com'))
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Offline and not in cache
        if (request.headers.get('accept').includes('text/html')) {
          return caches.match('/index.html');
        }
        return new Response('Network error occurred', {
          status: 488,
          statusText: 'Network Unavailable'
        });
      });
    })
  );
});
