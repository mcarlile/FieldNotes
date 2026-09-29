import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// This app no longer uses a service worker. Earlier versions registered one
// that cached the app shell and served stale content, forcing users into
// incognito to see updates. We now actively unregister any existing worker and
// clear its caches so every visitor gets fresh content straight from the server.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });

    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys().then((cacheNames) => {
        for (const cacheName of cacheNames) {
          caches.delete(cacheName);
        }
      });
    }
  });
}

// Update theme-color meta tag based on dark mode
const updateThemeColor = () => {
  const isDark = document.documentElement.classList.contains('dark');
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', isDark ? '#0a0a0a' : '#3b82f6');
  }
};

// Watch for theme changes
const observer = new MutationObserver(updateThemeColor);
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class']
});

// Set initial theme color
updateThemeColor();

createRoot(document.getElementById("root")!).render(<App />);
