import type mapboxgl from "mapbox-gl";

export interface MapStyleOption {
  id: string;
  name: string;
  url: string;
  /** Mapbox Standard config, set once the style has loaded. */
  basemapConfig?: Record<string, string>;
  /** Light falling snow over the map. */
  snow?: boolean;
}

export const DEFAULT_MAP_STYLE_ID = "default";

// The base layers offered by the route map's "Map layer" dropdown.
export const MAP_STYLES: MapStyleOption[] = [
  { id: DEFAULT_MAP_STYLE_ID, name: "Default", url: "mapbox://styles/mapbox/outdoors-v12" },
  {
    id: "winter",
    name: "Winter",
    url: "mapbox://styles/mapbox/standard",
    basemapConfig: { theme: "monochrome", lightPreset: "day" },
    snow: true,
  },
  { id: "satellite", name: "Satellite", url: "mapbox://styles/mapbox/satellite-streets-v12" },
];

export function getMapStyle(id: string | null | undefined): MapStyleOption {
  return MAP_STYLES.find((style) => style.id === id) ?? MAP_STYLES[0];
}

/**
 * Finishes a style once it has loaded: Standard's config and the snow effect.
 * Call from the map's `style.load`.
 */
export function applyMapStyleExtras(map: mapboxgl.Map, style: MapStyleOption) {
  Object.entries(style.basemapConfig ?? {}).forEach(([key, value]) => {
    map.setConfigProperty("basemap", key, value);
  });
  // Snow is experimental in mapbox-gl; a failure just leaves it off.
  try {
    map.setSnow(style.snow ? { density: 0.6, intensity: 0.5 } : null);
  } catch (error) {
    console.warn("Map snow effect unavailable:", error);
  }
}

const STORAGE_KEY = "bigmiles.mapStyle";

export function loadSavedMapStyleId(): string {
  try {
    return getMapStyle(localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_MAP_STYLE_ID;
  }
}

export function saveMapStyleId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private windows can refuse storage; the choice just isn't remembered.
  }
}
