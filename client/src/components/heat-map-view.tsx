import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initMapbox } from "@/lib/mapbox";
import type { FieldNote } from "@shared/schema";

interface HeatMapViewProps {
  fieldNotes: FieldNote[];
}

export default function HeatMapView({ fieldNotes }: HeatMapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;

    try {
      initMapbox();
    } catch (error) {
      console.error("Failed to initialize Mapbox:", error);
      return;
    }

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v11",
      center: [-120.2, 39.3], // Default center (Tahoe area)
      zoom: 10,
    });

    map.current.on("load", () => {
      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!map.current || !mapLoaded || fieldNotes.length === 0) return;

    // Remove existing layers and sources
    ["route-heat-low", "route-heat-medium", "route-heat-high", "route-heat"].forEach(layerId => {
      if (map.current.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });
    if (map.current.getSource("routes")) {
      map.current.removeSource("routes");
    }

    // Collect all route coordinates
    const allCoordinates: number[][] = [];
    let bounds = new mapboxgl.LngLatBounds();

    fieldNotes.forEach((note) => {
      const gpxData = note.gpxData as any;
      if (gpxData?.coordinates && Array.isArray(gpxData.coordinates)) {
        gpxData.coordinates.forEach((coord: [number, number]) => {
          if (Array.isArray(coord) && coord.length === 2) {
            allCoordinates.push(coord);
            bounds.extend(coord);
          }
        });
      }
    });

    if (allCoordinates.length === 0) return;

    // Create a grid-based heat map approach for better visualization
    const gridSize = 0.001; // Adjust for granularity (degrees)
    const segmentCounts = new Map<string, number>();
    
    // First pass: count segments in each grid cell
    fieldNotes.forEach((note) => {
      const gpxData = note.gpxData as any;
      if (gpxData?.coordinates && Array.isArray(gpxData.coordinates)) {
        const coordinates = gpxData.coordinates.filter(
          (coord: any): coord is [number, number] => 
            Array.isArray(coord) && coord.length === 2
        );

        coordinates.forEach((coord) => {
          const gridX = Math.floor(coord[0] / gridSize) * gridSize;
          const gridY = Math.floor(coord[1] / gridSize) * gridSize;
          const gridKey = `${gridX.toFixed(6)},${gridY.toFixed(6)}`;
          segmentCounts.set(gridKey, (segmentCounts.get(gridKey) || 0) + 1);
        });
      }
    });

    const maxCount = Math.max(...segmentCounts.values());
    
    // Create GeoJSON features with weighted line segments
    const features: any[] = [];
    
    fieldNotes.forEach((note, noteIndex) => {
      const gpxData = note.gpxData as any;
      if (gpxData?.coordinates && Array.isArray(gpxData.coordinates)) {
        const coordinates = gpxData.coordinates.filter(
          (coord: any): coord is [number, number] => 
            Array.isArray(coord) && coord.length === 2
        );

        if (coordinates.length > 1) {
          // Create line segments with calculated weights based on density
          for (let i = 0; i < coordinates.length - 1; i++) {
            const startCoord = coordinates[i];
            const endCoord = coordinates[i + 1];
            
            // Calculate weight based on grid density
            const startGridX = Math.floor(startCoord[0] / gridSize) * gridSize;
            const startGridY = Math.floor(startCoord[1] / gridSize) * gridSize;
            const startGridKey = `${startGridX.toFixed(6)},${startGridY.toFixed(6)}`;
            const weight = (segmentCounts.get(startGridKey) || 1) / maxCount;

            features.push({
              type: "Feature",
              properties: {
                noteId: note.id,
                tripType: note.tripType,
                weight: weight,
                density: segmentCounts.get(startGridKey) || 1,
              },
              geometry: {
                type: "LineString",
                coordinates: [startCoord, endCoord],
              },
            });
          }
        }
      }
    });

    if (features.length === 0) return;

    // Add source
    map.current.addSource("routes", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: features,
      },
      lineMetrics: true,
    });

    // Add multiple layers for better heat map visualization
    
    // Base layer for low-density routes
    map.current.addLayer({
      id: "route-heat-low",
      type: "line",
      source: "routes",
      filter: ["<", ["get", "weight"], 0.3],
      paint: {
        "line-color": "#3b82f6", // Blue for low density
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 1,
          14, 3,
          18, 6,
        ],
        "line-opacity": 0.6,
      },
    });
    
    // Medium layer for medium-density routes
    map.current.addLayer({
      id: "route-heat-medium",
      type: "line",
      source: "routes",
      filter: ["all", [">=", ["get", "weight"], 0.3], ["<", ["get", "weight"], 0.7]],
      paint: {
        "line-color": "#f59e0b", // Orange for medium density
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 2,
          14, 5,
          18, 10,
        ],
        "line-opacity": 0.8,
      },
    });
    
    // High layer for high-density routes
    map.current.addLayer({
      id: "route-heat-high",
      type: "line",
      source: "routes",
      filter: [">=", ["get", "weight"], 0.7],
      paint: {
        "line-color": "#dc2626", // Red for high density
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 3,
          14, 7,
          18, 14,
        ],
        "line-opacity": 1.0,
      },
    });

    // Fit map to show all routes
    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 14,
      });
    }

    // Add hover effects for all heat map layers
    let hoveredNoteId: string | null = null;
    
    const addHoverEffects = (layerId: string) => {
      map.current.on("mouseenter", layerId, (e) => {
        map.current!.getCanvas().style.cursor = "pointer";
        
        if (e.features && e.features[0]) {
          const feature = e.features[0];
          const noteId = feature.properties?.noteId;
          const density = feature.properties?.density;
          
          if (noteId && noteId !== hoveredNoteId) {
            hoveredNoteId = noteId;
            const note = fieldNotes.find(n => n.id === noteId);
            
            if (note && e.lngLat) {
              new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
                .setLngLat(e.lngLat)
                .setHTML(`
                  <div class="text-sm">
                    <strong>${note.title}</strong><br/>
                    <span class="text-gray-600">${note.tripType}</span><br/>
                    <span class="text-xs text-gray-500">${note.distance}mi • ${note.elevationGain}ft gain</span><br/>
                    <span class="text-xs text-blue-600">Density: ${density} ${density === 1 ? 'route' : 'routes'}</span>
                  </div>
                `)
                .addTo(map.current!);
            }
          }
        }
      });

      map.current.on("mouseleave", layerId, () => {
        map.current!.getCanvas().style.cursor = "";
        hoveredNoteId = null;
        
        // Remove all popups
        const popups = document.querySelectorAll('.mapboxgl-popup');
        popups.forEach(popup => popup.remove());
      });
    };

    // Add hover effects to all layers
    ["route-heat-low", "route-heat-medium", "route-heat-high"].forEach(addHoverEffects);

  }, [fieldNotes, mapLoaded]);

  return (
    <div className="relative w-full h-screen">
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Heat Map Legend */}
      {mapLoaded && fieldNotes.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Route Density</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-4 h-0.5 bg-blue-500" style={{ opacity: 0.6 }}></div>
              <span className="text-xs text-gray-700">Low traffic</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-1 bg-orange-500" style={{ opacity: 0.8 }}></div>
              <span className="text-xs text-gray-700">Medium traffic</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-1.5 bg-red-600"></div>
              <span className="text-xs text-gray-700">High traffic</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              {fieldNotes.length} route{fieldNotes.length === 1 ? '' : 's'} aggregated
            </p>
          </div>
        </div>
      )}
      
      {fieldNotes.length === 0 && (
        <div className="absolute inset-0 bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No routes to display</h3>
            <p className="text-gray-600">Add some field notes with GPX data to see the heat map</p>
          </div>
        </div>
      )}
      
      {!mapLoaded && fieldNotes.length > 0 && (
        <div className="absolute inset-0 bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading heat map...</p>
          </div>
        </div>
      )}
    </div>
  );
}