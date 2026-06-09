const CACHE_NAME = 'big-miles-v2';

// Install: claim clients immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: clear old caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for HTML/API, cache-first for hashed assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Skip non-GET, API calls, and external requests
  if (event.request.method !== 'GET' ||
      url.pathname.startsWith('/api/') ||
      url.pathname.includes('/video/') ||
      !isSameOrigin) {
    return;
  }

  // Hash-fingerprinted assets (e.g., /assets/index-Dv7TvVuV.js) — cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages and other navigation — network-first, cache as fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Fallback: return cached root page for navigation
          if (event.request.destination === 'document') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
