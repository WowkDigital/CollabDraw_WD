const CACHE_NAME = 'codraw-cache-v1';

// Static resources to cache immediately on install
const STATIC_ASSETS = [
  './',
  'index.php',
  'manifest.json',
  'js/app.js',
  'js/canvas.js',
  'js/sync.js',
  'js/ui.js',
  'icon-192.png',
  'icon-512.png',
  'widgets/board-template.json',
  'widgets/board-data.json'
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

  // Intercept widget image request
  if (url.pathname.endsWith('/widgets/current-board.png')) {
    event.respondWith(
      caches.open('codraw-widget-cache').then((cache) => {
        return cache.match(url.pathname).then((response) => {
          if (response) {
            return response;
          }
          // Fallback to cached default icon if drawing is not available yet
          return caches.match('icon-192.png') || fetch('icon-192.png');
        });
      })
    );
    return;
  }

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
          return caches.match('index.php');
        }
        return new Response('Network error occurred', {
          status: 488,
          statusText: 'Network Unavailable'
        });
      });
    })
  );
});

// --- PWA Widget Lifecycle & Message Handlers ---

// Listen for message from client to update widgets
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'UPDATE_WIDGET_PREVIEW') {
    event.waitUntil(updatePWAWidget());
  }
});

self.addEventListener('widgetinstall', (event) => {
  event.waitUntil(updatePWAWidgetInstance(event.widget));
});

self.addEventListener('widgetuninstall', (event) => {
  // Clean up cache or resources if needed
});

self.addEventListener('widgetresume', (event) => {
  event.waitUntil(updatePWAWidgetInstance(event.widget));
});

// Update all active widget instances matching our tag
async function updatePWAWidget() {
  if (!self.widgets || typeof self.widgets.updateByTag !== 'function') {
    return;
  }
  try {
    const template = await fetchWidgetTemplate();
    const data = await fetchWidgetData();
    await self.widgets.updateByTag('codraw-board-widget', {
      template,
      data
    });
  } catch (err) {
    console.error('[Service Worker] Error updating PWA widget:', err);
  }
}

// Update a specific widget instance
async function updatePWAWidgetInstance(widget) {
  if (!self.widgets || typeof self.widgets.updateByInstanceId !== 'function') {
    return;
  }
  try {
    const template = await fetchWidgetTemplate();
    const data = await fetchWidgetData();
    await self.widgets.updateByInstanceId(widget.id, {
      template,
      data
    });
  } catch (err) {
    console.error(`[Service Worker] Error updating widget instance ${widget.id}:`, err);
  }
}

// Helper to fetch adaptive card template
async function fetchWidgetTemplate() {
  const response = await fetch('widgets/board-template.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch widget template: ${response.statusText}`);
  }
  return await response.text();
}

// Helper to construct dynamic widget data
async function fetchWidgetData() {
  const scope = self.registration.scope;
  const boardImageUrl = new URL('widgets/current-board.png', scope).href;
  const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  return JSON.stringify({
    boardImageUrl: boardImageUrl + '?t=' + Date.now(),
    lastUpdated: `Zaktualizowano o ${timeString}`,
    appUrl: scope
  });
}

