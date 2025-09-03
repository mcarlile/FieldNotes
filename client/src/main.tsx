import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration);
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
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
