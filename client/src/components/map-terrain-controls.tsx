import type mapboxgl from "mapbox-gl";

// Exaggerated terrain makes climbs and valleys read clearly from above; 1 is
// true scale.
export const EXAGGERATED_TERRAIN = 4.0;
export const TRUE_SCALE_TERRAIN = 1.0;
export const TERRAIN_PITCH = 55;

const DEM_SOURCE = "mapbox-dem";
const SKY_LAYER = "sky";

/**
 * Turns 3D terrain on or off on a loaded map. Safe to call repeatedly, and
 * again after a style change wipes the terrain source.
 */
export function applyTerrain(map: mapboxgl.Map, options: { is3D: boolean; exaggerate: boolean }) {
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
    exaggeration: options.exaggerate ? EXAGGERATED_TERRAIN : TRUE_SCALE_TERRAIN,
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
  exaggerate: boolean;
  onToggle3D: () => void;
  onToggleExaggerate: () => void;
  className?: string;
}

/** The 3D switch and "Exaggerate terrain" checkbox shared by our maps. */
export function MapTerrainControls({ is3D, exaggerate, onToggle3D, onToggleExaggerate, className }: MapTerrainControlsProps) {
  return (
    <div className={`bg-card border border-border rounded-lg p-3 shadow-lg space-y-2 ${className ?? ""}`}>
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
      <label
        className={`flex items-center gap-2 text-sm text-foreground select-none ${
          is3D ? "cursor-pointer" : "opacity-50 cursor-not-allowed"
        }`}
        title={is3D ? undefined : "Turn on 3D to see terrain"}
      >
        <input
          type="checkbox"
          checked={exaggerate}
          onChange={onToggleExaggerate}
          disabled={!is3D}
          data-testid="checkbox-exaggerate-terrain"
        />
        Exaggerate terrain
      </label>
    </div>
  );
}
