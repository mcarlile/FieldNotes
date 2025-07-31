import mapboxgl from "mapbox-gl";

// Initialize Mapbox with access token
export function initMapbox() {
  const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || 
                     process.env.MAPBOX_ACCESS_TOKEN || 
                     "pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4M29iazA2Z2gycXA4N2pmbDZmangifQ.-g_vE53SD2WrJ6tFX7QHmA";
  
  mapboxgl.accessToken = accessToken;
}
