import type mapboxgl from "mapbox-gl";

// 3D terrain is always drawn at true scale, never exaggerated.
export const TERRAIN_EXAGGERATION = 1.0;
export const TERRAIN_PITCH = 55;

const DEM_SOURCE = "mapbox-dem";
const SKY_LAYER = "sky";

/**
 * Turns 3D terrain on or off on a loaded map. Safe to call repeatedly, and
 * again after a style change wipes the terrain source.
 */
export function applyTerrain(map: mapboxgl.Map, options: { is3D: boolean }) {
  if (!options.is3D) {
    map.setTerrain(null);
    if (map.getLayer(SKY_LAYER)) map.removeLayer(SKY_LAYER);
    return;
  }
  if (!map.getSource(DEM_SOURCE)) {
    map.addSource(DEM_SOURCE, {
      type: "raster-dem",
      url: "mapbox://mapbox.mapbox-terrain-dem-v1",
      tileSize: 512,
      maxzoom: 14,
    });
  }
  map.setTerrain({
    source: DEM_SOURCE,
    exaggeration: TERRAIN_EXAGGERATION,
  });
  if (!map.getLayer(SKY_LAYER)) {
    map.addLayer(
      {
        id: SKY_LAYER,
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0.0, 0.0],
          "sky-atmosphere-sun-intensity": 15,
        },
      },
      // Keep the sky behind everything when the style has a water layer.
      map.getLayer("water") ? "water" : undefined,
    );
  }
}

interface MapTerrainControlsProps {
  is3D: boolean;
  onToggle3D: () => void;
  className?: string;
}

/** The 3D switch shared by our maps. */
export function MapTerrainControls({ is3D, onToggle3D, className }: MapTerrainControlsProps) {
  return (
    <div className={`bg-card border border-border rounded-lg p-3 shadow-lg ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">3D View</span>
        <button
          type="button"
          onClick={onToggle3D}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            is3D ? "bg-primary" : "bg-muted"
          }`}
          aria-label="Toggle 3D mode"
          aria-pressed={is3D}
          data-testid="toggle-3d"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              is3D ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
