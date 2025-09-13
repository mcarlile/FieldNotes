import mapboxgl from "mapbox-gl";

// Check if WebGL is supported
export function isWebGLSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (e) {
    return false;
  }
}

// Initialize Mapbox with access token and WebGL check
export function initMapbox() {
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error("VITE_MAPBOX_ACCESS_TOKEN environment variable is required");
  }

  // Check WebGL support before initializing
  if (!isWebGLSupported()) {
    console.warn("WebGL is not supported in this environment. Maps may not render properly.");
    // Don't throw error, just warn and continue
  }
  
  mapboxgl.accessToken = accessToken;
}
