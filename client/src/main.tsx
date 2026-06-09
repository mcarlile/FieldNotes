import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Force-unregister old service workers that may have stale caches
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        const scope = registration.scope;
        const sw = registration.installing || registration.waiting || registration.active;
        const scriptURL = sw?.scriptURL || '';
        // If the old worker doesn't match our new sw.js, unregister it
        if (!scriptURL.endsWith('/sw.js')) {
          registration.unregister();
        }
      }
    });

    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration);
      })
      .catch((registrationError) => {
        console.log('SW registration failed:', registrationError);
      });
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
