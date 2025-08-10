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
    const existingLayers = ["route-heat-low", "route-heat-medium", "route-heat-high", "route-touch-targets", "route-heat"];
    
    // Also remove individual route layers
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

          // Create complete route as single feature
          features.push({
            type: "Feature",
            properties: {
              noteId: note.id,
              title: note.title,
              tripType: note.tripType,
              routeIndex: totalRoutes,
              originalLength: coordinates.length,
              sampledLength: sampledCoords.length,
            },
            geometry: {
              type: "LineString",
              coordinates: sampledCoords,
            },
          });
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

    // Add all routes with distinct colors and good visibility
    const routeColors = [
      "#3b82f6", // Blue
      "#ef4444", // Red  
      "#10b981", // Green
      "#f59e0b", // Amber
      "#8b5cf6", // Purple
      "#ec4899", // Pink
      "#06b6d4", // Cyan
      "#84cc16", // Lime
    ];

    // Add individual route layers for each route
    features.forEach((feature, index) => {
      const layerId = `route-${feature.properties.noteId}`;
      const color = routeColors[index % routeColors.length];
      
      map.current.addLayer({
        id: layerId,
        type: "line",
        source: "routes",
        filter: ["==", ["get", "noteId"], feature.properties.noteId],
        paint: {
          "line-color": color,
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
      const routeLayerIds = features.map(f => `route-${f.properties.noteId}`);
      const clickedFeatures = map.current!.queryRenderedFeatures(
        [
          [e.point.x - buffer, e.point.y - buffer],
          [e.point.x + buffer, e.point.y + buffer]
        ],
        { layers: routeLayerIds }
      );

      if (clickedFeatures.length === 0) return;

      // Remove existing popup
      if (activePopup) {
        activePopup.remove();
        activePopup = null;
      }

      // Group features by noteId to avoid duplicates
      const uniqueNotes = new Map();
      clickedFeatures.forEach(feature => {
        const noteId = feature.properties?.noteId;
        if (noteId && !uniqueNotes.has(noteId)) {
          const note = fieldNotes.find(n => n.id === noteId);
          if (note) {
            uniqueNotes.set(noteId, { note });
          }
        }
      });

      if (uniqueNotes.size === 0) return;

      // Create popup content
      const notesList = Array.from(uniqueNotes.values());
      const popupContent = notesList.length === 1 
        ? // Single route
          `<div class="text-sm max-w-64">
             <strong>${notesList[0].note.title}</strong><br/>
             <span class="text-gray-600">${notesList[0].note.tripType}</span><br/>
             <span class="text-xs text-gray-500">${notesList[0].note.distance}mi • ${notesList[0].note.elevationGain}ft gain</span>
           </div>`
        : // Multiple routes
          `<div class="text-sm max-w-64">
             <strong>${notesList.length} Routes Intersect Here:</strong><br/>
             ${notesList.map(({ note }) => 
               `<div class="mt-2 pl-2 border-l-2 border-gray-300">
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
    const allLayerIds = [...features.map(f => `route-${f.properties.noteId}`), "route-touch-targets"];
    
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