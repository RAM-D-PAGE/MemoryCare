const CACHE_NAME = 'memorycare-cache-v1';
const ASSETS_TO_CACHE = [
  'MemoryCare_App.html',
  'config.js',
  'hybrid-sync.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

// Install Service Worker and cache essential static assets locally
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app shell assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[Service Worker] Assets cached successfully. Activating immediately.');
        return self.skipWaiting(); // Nested inside chain properly
      })
      .catch((err) => {
        console.error('[Service Worker] Cache pre-fill failed during install:', err);
      })
  );
});

// Activate event and clear obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log('[Service Worker] Clearing old cache storage:', cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => {
        console.log('[Service Worker] Obsolete caches cleared. Claiming active clients.');
        return self.clients.claim(); // Properly chained inside waitUntil promise
      })
      .catch((err) => {
        console.error('[Service Worker] Activation failed:', err);
      })
  );
});

// Intercept fetch requests and serve cached files instantly (Cache-First strategy)
self.addEventListener('fetch', (event) => {
  // 1. Bypass non-GET requests (e.g. POST, PUT, DELETE must go straight to network)
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Bypass API database queries (never cache dynamic REST API endpoints)
  const isApiCall = event.request.url.includes('/api/') || 
                     event.request.url.includes('api.memorycare-system.com') ||
                     event.request.url.includes('supabase.co');
  if (isApiCall) {
    return; // Bypass completely!
  }

  // 3. Intercept local static assets OR external Google Fonts domains
  const isLocalAsset = event.request.url.startsWith(self.location.origin);
  const isGoogleFont = event.request.url.includes('fonts.googleapis.com') || 
                       event.request.url.includes('fonts.gstatic.com');

  if (isLocalAsset || isGoogleFont) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse; // Serve cached resource instantly
        }
        return fetch(event.request).then((networkResponse) => {
          // If valid response, dynamically cache it for future offline usage
          if (networkResponse && networkResponse.status === 200) {
            return caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
              return networkResponse;
            });
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[Service Worker] Network request failed for:', event.request.url, err);
          // High-security fallback: If offline and resource is not in cache, return a graceful 503 response
          return cachedResponse || new Response('MemoryCare Offline Mode — Resource Unreachable', { 
            status: 503, 
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' } 
          });
        });
      })
    );
  }
});
