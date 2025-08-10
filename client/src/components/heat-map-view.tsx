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
    
    // Ensure map style is fully loaded before adding layers
    if (!map.current.isStyleLoaded()) {
      const checkStyleLoaded = () => {
        if (map.current && map.current.isStyleLoaded()) {
          map.current.off('styledata', checkStyleLoaded);
          // Retry the layer creation
          setTimeout(() => setMapLoaded(true), 100);
        }
      };
      map.current.on('styledata', checkStyleLoaded);
      return;
    }

    // Remove existing layers and sources
    const existingLayers = [
      "route-heat-single", "route-heat-medium", "route-heat-high", 
      "route-touch-targets", "route-heat-low", "route-heat"
    ];
    
    // Also remove individual route layers if they exist
    fieldNotes.forEach(note => {
      existingLayers.push(`route-${note.id}`);
    });
    
    existingLayers.forEach(layerId => {
      if (map.current.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });
    
    if (map.current.getSource("routes")) {
      map.current.removeSource("routes");
    }

    // Collect all route coordinates and debug info
    const allCoordinates: number[][] = [];
    let bounds = new mapboxgl.LngLatBounds();
    let routeStats: any[] = [];

    fieldNotes.forEach((note, index) => {
      const gpxData = note.gpxData as any;
      if (gpxData?.coordinates && Array.isArray(gpxData.coordinates)) {
        const validCoords = gpxData.coordinates.filter((coord: any) => 
          Array.isArray(coord) && coord.length === 2 && 
          typeof coord[0] === 'number' && typeof coord[1] === 'number'
        );
        
        routeStats.push({
          title: note.title,
          coordCount: validCoords.length,
          tripType: note.tripType
        });

        validCoords.forEach((coord: [number, number]) => {
          allCoordinates.push(coord);
          bounds.extend(coord);
        });
      } else {
        routeStats.push({
          title: note.title,
          coordCount: 0,
          tripType: note.tripType
        });
      }
    });

    console.log('Heat map route analysis:', routeStats);
    console.log(`Total coordinates from ${fieldNotes.length} field notes: ${allCoordinates.length}`);

    if (allCoordinates.length === 0) {
      console.log('No valid coordinates found for heat map');
      return;
    }

    // Create a more precise overlap detection system
    const gridSize = 0.0005; // Smaller grid for better precision (degrees)
    const routeSegments = new Map<string, Set<string>>(); // Track which routes pass through each grid cell
    
    // First pass: map each route's path through grid cells
    fieldNotes.forEach((note) => {
      const gpxData = note.gpxData as any;
      if (gpxData?.coordinates && Array.isArray(gpxData.coordinates)) {
        const coordinates = gpxData.coordinates.filter(
          (coord: any): coord is [number, number] => 
            Array.isArray(coord) && coord.length === 2 &&
            typeof coord[0] === 'number' && typeof coord[1] === 'number'
        );

        coordinates.forEach((coord) => {
          const gridX = Math.floor(coord[0] / gridSize) * gridSize;
          const gridY = Math.floor(coord[1] / gridSize) * gridSize;
          const gridKey = `${gridX.toFixed(8)},${gridY.toFixed(8)}`;
          
          if (!routeSegments.has(gridKey)) {
            routeSegments.set(gridKey, new Set());
          }
          routeSegments.get(gridKey)!.add(note.id);
        });
      }
    });

    // Calculate overlap density for each grid cell
    const overlapCounts = new Map<string, number>();
    routeSegments.forEach((routeIds, gridKey) => {
      overlapCounts.set(gridKey, routeIds.size);
    });

    const maxOverlap = Math.max(...overlapCounts.values(), 1);
    console.log(`Grid analysis: ${routeSegments.size} cells, max overlap: ${maxOverlap} routes`);
    
    // Create GeoJSON features for each complete route
    const features: any[] = [];
    let totalRoutes = 0;
    
    fieldNotes.forEach((note, noteIndex) => {
      const gpxData = note.gpxData as any;
      if (gpxData?.coordinates && Array.isArray(gpxData.coordinates)) {
        const coordinates = gpxData.coordinates.filter(
          (coord: any): coord is [number, number] => 
            Array.isArray(coord) && coord.length === 2 &&
            typeof coord[0] === 'number' && typeof coord[1] === 'number'
        );

        if (coordinates.length > 1) {
          totalRoutes++;
          
          // For routes with many points, sample them to avoid overwhelming the visualization
          const maxPointsPerRoute = 500;
          const sampleRate = coordinates.length > maxPointsPerRoute 
            ? Math.ceil(coordinates.length / maxPointsPerRoute) 
            : 1;
          
          const sampledCoords = coordinates.filter((_, index) => index % sampleRate === 0);
          
          // Ensure we keep the last coordinate
          if (sampledCoords[sampledCoords.length - 1] !== coordinates[coordinates.length - 1]) {
            sampledCoords.push(coordinates[coordinates.length - 1]);
          }

          console.log(`Route "${note.title}": ${coordinates.length} coords → ${sampledCoords.length} sampled (rate: ${sampleRate})`);

          // Create line segments with overlap density calculation
          for (let i = 0; i < sampledCoords.length - 1; i++) {
            const startCoord = sampledCoords[i];
            const endCoord = sampledCoords[i + 1];
            
            // Calculate overlap density for this segment
            const gridX = Math.floor(startCoord[0] / gridSize) * gridSize;
            const gridY = Math.floor(startCoord[1] / gridSize) * gridSize;
            const gridKey = `${gridX.toFixed(8)},${gridY.toFixed(8)}`;
            const overlapCount = overlapCounts.get(gridKey) || 1;
            const density = overlapCount / maxOverlap;

            features.push({
              type: "Feature",
              properties: {
                noteId: note.id,
                title: note.title,
                tripType: note.tripType,
                overlapCount: overlapCount,
                density: density,
                routeIds: Array.from(routeSegments.get(gridKey) || [note.id]),
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

    console.log(`Created ${features.length} route features from ${totalRoutes} valid routes`);

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

    // Add density-based heat map layers
    // Low density (single route) - neutral blue
    map.current.addLayer({
      id: "route-heat-single",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "overlapCount"], 1],
      paint: {
        "line-color": "#3b82f6", // Neutral blue for single routes
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 3,
          14, 6,
          18, 12,
        ],
        "line-opacity": 0.7,
      },
    });

    // Medium overlap (2-3 routes) - orange
    map.current.addLayer({
      id: "route-heat-medium",
      type: "line",
      source: "routes",
      filter: ["all", [">=", ["get", "overlapCount"], 2], ["<=", ["get", "overlapCount"], 3]],
      paint: {
        "line-color": "#f59e0b", // Orange for medium overlap
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 4,
          14, 8,
          18, 16,
        ],
        "line-opacity": 0.8,
      },
    });

    // High overlap (4+ routes) - red
    map.current.addLayer({
      id: "route-heat-high",
      type: "line",
      source: "routes",
      filter: [">=", ["get", "overlapCount"], 4],
      paint: {
        "line-color": "#dc2626", // Red for high overlap
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 5,
          14, 10,
          18, 20,
        ],
        "line-opacity": 0.9,
      },
    });

    // Add invisible wider touch targets for better interaction
    map.current.addLayer({
      id: "route-touch-targets",
      type: "line",
      source: "routes",
      paint: {
        "line-color": "transparent",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8, 20,
          14, 30,
          18, 40,
        ],
        "line-opacity": 0,
      },
    });

    // Fit map to show all routes
    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 14,
      });
    }

    // Add click and hover effects for route interaction
    let activePopup: mapboxgl.Popup | null = null;

    const handleRouteInteraction = (e: mapboxgl.MapMouseEvent & mapboxgl.EventData) => {
      if (!e.lngLat) return;

      // Query all route features at this point with a generous buffer
      const buffer = 15; // Pixel buffer for generous touch targets
      const heatMapLayers = ["route-heat-single", "route-heat-medium", "route-heat-high"];
      const clickedFeatures = map.current!.queryRenderedFeatures(
        [
          [e.point.x - buffer, e.point.y - buffer],
          [e.point.x + buffer, e.point.y + buffer]
        ],
        { layers: heatMapLayers }
      );

      if (clickedFeatures.length === 0) return;

      // Remove existing popup
      if (activePopup) {
        activePopup.remove();
        activePopup = null;
      }

      // Get the first feature to show overlap info
      if (clickedFeatures.length === 0) return;
      const feature = clickedFeatures[0];
      const overlapCount = feature.properties?.overlapCount || 1;
      const routeIds = feature.properties?.routeIds || [feature.properties?.noteId];

      // Find all routes that intersect at this point
      const intersectingNotes = routeIds.map((id: string) => fieldNotes.find(n => n.id === id)).filter(Boolean);

      const popupContent = intersectingNotes.length === 1
        ? // Single route
          `<div class="text-sm max-w-64">
             <strong>${intersectingNotes[0].title}</strong><br/>
             <span class="text-gray-600">${intersectingNotes[0].tripType}</span><br/>
             <span class="text-xs text-gray-500">${intersectingNotes[0].distance}mi • ${intersectingNotes[0].elevationGain}ft gain</span>
           </div>`
        : // Multiple routes overlapping
          `<div class="text-sm max-w-64">
             <strong>${overlapCount} Routes Overlap Here:</strong><br/>
             ${intersectingNotes.map(note => 
               `<div class="mt-2 pl-2 border-l-2 border-orange-300">
                  <strong>${note.title}</strong><br/>
                  <span class="text-gray-600 text-xs">${note.tripType} • ${note.distance}mi</span>
                </div>`
             ).join('')}
           </div>`;

      activePopup = new mapboxgl.Popup({ 
        closeButton: true, 
        closeOnClick: false,
        maxWidth: "300px"
      })
        .setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(map.current!);
    };

    // Add click handlers to the touch target layer for generous interaction
    map.current.on("click", "route-touch-targets", handleRouteInteraction);
    
    // Add hover effects for visual feedback
    const allLayerIds = ["route-heat-single", "route-heat-medium", "route-heat-high", "route-touch-targets"];
    
    allLayerIds.forEach(layerId => {
      map.current.on("mouseenter", layerId, () => {
        map.current!.getCanvas().style.cursor = "pointer";
      });

      map.current.on("mouseleave", layerId, () => {
        map.current!.getCanvas().style.cursor = "";
      });
    });

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