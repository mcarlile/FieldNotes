// Kill-switch service worker.
//
// This app no longer uses a service worker. Earlier versions registered a
// caching service worker that served a stale app shell, forcing users to open
// the site in incognito to see updates. Browsers re-check this sw.js file on
// every navigation, so shipping this self-destroying worker guarantees the old
// worker is replaced by one that removes itself and all of its caches.

self.addEventListener('install', () => {
  // Activate immediately, replacing any previously installed worker.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete every cache this origin created.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // 2. Unregister this service worker so nothing intercepts requests anymore.
      await self.registration.unregister();

      // 3. Reload every open tab so they re-fetch fresh content from the server.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
