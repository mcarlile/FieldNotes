import mapboxgl from "mapbox-gl";

// Initialize Mapbox with access token
export function initMapbox() {
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error("VITE_MAPBOX_ACCESS_TOKEN environment variable is required");
  }
  
  mapboxgl.accessToken = accessToken;
}
