import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initMapbox } from "@/lib/mapbox";
import { useTheme } from "@/contexts/theme-context";
import type { FieldNote } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";

interface HeatMapViewProps {
  fieldNotes: FieldNote[];
}

export default function HeatMapView({ fieldNotes }: HeatMapViewProps) {
  const { theme } = useTheme();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Theme-aware colors
  const getThemeColors = () => {
    return theme === "dark" 
      ? {
          primary: "#60a5fa",    // Lighter blue for dark mode
          warning: "#fbbf24",    // Lighter orange for dark mode  
          destructive: "#f87171" // Lighter red for dark mode
        }
      : {
          primary: "#3b82f6",    // Standard blue for light mode
          warning: "#f59e0b",    // Standard orange for light mode
          destructive: "#dc2626" // Standard red for light mode
        };
  };

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
      if (map.current && map.current.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });
    
    if (map.current && map.current.getSource("routes")) {
      map.current.removeSource("routes");
    }

    // Collect all route coordinates and debug info
    const allCoordinates: number[][] = [];
    let bounds = new mapboxgl.LngLatBounds();
    let routeStats: any[] = [];

    fieldNotes.forEach((note, index) => {
      let coordinates: [number, number][] = [];
      
      try {
        if (typeof note.gpxData === 'string') {
          // Parse GPX XML data
          const parsed = parseGpxData(note.gpxData);
          coordinates = parsed.coordinates;
        } else if (note.gpxData && typeof note.gpxData === 'object') {
          // Handle pre-parsed GPX data
          const gpxObject = note.gpxData as any;
          if (gpxObject.coordinates && Array.isArray(gpxObject.coordinates)) {
            coordinates = gpxObject.coordinates.filter((coord: any) => 
              Array.isArray(coord) && coord.length === 2 && 
              typeof coord[0] === 'number' && typeof coord[1] === 'number'
            );
          }
        }
      } catch (error) {
        console.error(`Failed to parse GPX data for "${note.title}":`, error);
      }
      
      routeStats.push({
        title: note.title,
        coordCount: coordinates.length,
        tripType: note.tripType
      });

      coordinates.forEach((coord: [number, number]) => {
        allCoordinates.push(coord);
        bounds.extend(coord);
      });
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
      let coordinates: [number, number][] = [];
      
      try {
        if (typeof note.gpxData === 'string') {
          // Parse GPX XML data
          const parsed = parseGpxData(note.gpxData);
          coordinates = parsed.coordinates;
        } else if (note.gpxData && typeof note.gpxData === 'object') {
          // Handle pre-parsed GPX data
          const gpxObject = note.gpxData as any;
          if (gpxObject.coordinates && Array.isArray(gpxObject.coordinates)) {
            coordinates = gpxObject.coordinates.filter(
              (coord: any): coord is [number, number] => 
                Array.isArray(coord) && coord.length === 2 &&
                typeof coord[0] === 'number' && typeof coord[1] === 'number'
            );
          }
        }
      } catch (error) {
        console.error(`Failed to parse GPX data for grid analysis "${note.title}":`, error);
      }

      coordinates.forEach((coord) => {
        const gridX = Math.floor(coord[0] / gridSize) * gridSize;
        const gridY = Math.floor(coord[1] / gridSize) * gridSize;
        const gridKey = `${gridX.toFixed(8)},${gridY.toFixed(8)}`;
        
        if (!routeSegments.has(gridKey)) {
          routeSegments.set(gridKey, new Set());
        }
        routeSegments.get(gridKey)!.add(note.id);
      });
    });

    // Calculate overlap density for each grid cell
    const overlapCounts = new Map<string, number>();
    routeSegments.forEach((routeIds, gridKey) => {
      overlapCounts.set(gridKey, routeIds.size);
    });

    const maxOverlap = Math.max(...Array.from(overlapCounts.values()), 1);
    console.log(`Grid analysis: ${routeSegments.size} cells, max overlap: ${maxOverlap} routes`);
    
    // Create GeoJSON features for each complete route
    const features: any[] = [];
    let totalRoutes = 0;
    
    fieldNotes.forEach((note, noteIndex) => {
      let coordinates: [number, number][] = [];
      
      try {
        if (typeof note.gpxData === 'string') {
          // Parse GPX XML data
          const parsed = parseGpxData(note.gpxData);
          coordinates = parsed.coordinates;
        } else if (note.gpxData && typeof note.gpxData === 'object') {
          // Handle pre-parsed GPX data
          const gpxObject = note.gpxData as any;
          if (gpxObject.coordinates && Array.isArray(gpxObject.coordinates)) {
            coordinates = gpxObject.coordinates.filter(
              (coord: any): coord is [number, number] => 
                Array.isArray(coord) && coord.length === 2 &&
                typeof coord[0] === 'number' && typeof coord[1] === 'number'
            );
          }
        }
      } catch (error) {
        console.error(`Failed to parse GPX data for feature creation "${note.title}":`, error);
      }

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

    const colors = getThemeColors();

    // Add density-based heat map layers
    // Low density (single route) - neutral blue
    map.current.addLayer({
      id: "route-heat-single",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "overlapCount"], 1],
      paint: {
        "line-color": colors.primary, // Theme-aware blue for single routes
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
        "line-color": colors.warning, // Theme-aware orange for medium overlap
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
        "line-color": colors.destructive, // Theme-aware red for high overlap
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

    const handleRouteInteraction = (e: mapboxgl.MapMouseEvent) => {
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
      const routeIds = feature.properties?.routeIds;
      
      // Ensure routeIds is an array and fallback to single noteId if needed
      let routeIdArray: string[] = [];
      if (Array.isArray(routeIds)) {
        routeIdArray = routeIds;
      } else if (feature.properties?.noteId) {
        routeIdArray = [feature.properties.noteId];
      }

      // Find all routes that intersect at this point
      const intersectingNotes = routeIdArray.map((id: string) => fieldNotes.find(n => n.id === id)).filter(Boolean);

      const popupContent = intersectingNotes.length === 1 && intersectingNotes[0]
        ? // Single route
          `<div class="text-sm max-w-64">
             <a href="/field-notes/${intersectingNotes[0].id}" class="font-semibold underline" style="color: ${colors.primary}; text-decoration: underline;">
               ${intersectingNotes[0].title}
             </a><br/>
             <span style="color: #6b7280;">${intersectingNotes[0].tripType}</span><br/>
             <span class="text-xs" style="color: #6b7280;">${intersectingNotes[0].distance}mi • ${intersectingNotes[0].elevationGain}ft gain</span><br/>
             <span class="text-xs" style="color: ${colors.primary};">Click to view details</span>
           </div>`
        : // Multiple routes overlapping
          `<div class="text-sm max-w-64">
             <strong>${overlapCount} Routes Overlap Here:</strong><br/>
             ${intersectingNotes.filter(note => note).map(note => 
               `<div class="mt-2 pl-2 border-l-2" style="border-color: ${colors.warning};">
                  <a href="/field-notes/${note!.id}" class="font-semibold underline" style="color: ${colors.primary}; text-decoration: underline;">
                    ${note!.title}
                  </a><br/>
                  <span class="text-xs" style="color: #6b7280;">${note!.tripType} • ${note!.distance}mi</span>
                </div>`
             ).join('')}
             <div class="mt-2 text-xs" style="color: ${colors.primary};">Click any route to view details</div>
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
    
    // Add enhanced hover effects with glowing and prominence
    const visibleLayerIds = ["route-heat-single", "route-heat-medium", "route-heat-high"];
    const allLayerIds = [...visibleLayerIds, "route-touch-targets"];
    
    allLayerIds.forEach(layerId => {
      map.current!.on("mouseenter", layerId, (e) => {
        if (map.current) {
          map.current.getCanvas().style.cursor = "pointer";
        }
        
        // Query features at hover point to get route information
        if (e.features && e.features.length > 0) {
          const hoveredFeature = e.features[0];
          const routeIds = hoveredFeature.properties?.routeIds;
          const noteId = hoveredFeature.properties?.noteId;
          
          // Get all route IDs that should be highlighted
          let highlightRouteIds: string[] = [];
          if (Array.isArray(routeIds)) {
            highlightRouteIds = routeIds;
          } else if (noteId) {
            highlightRouteIds = [noteId];
          }
          
          // Apply enhanced styling to all layers for matching routes
          visibleLayerIds.forEach(visibleLayerId => {
            // Create filter to highlight only the hovered routes
            const filter = ["in", ["get", "noteId"], ["literal", highlightRouteIds]];
            
            // Apply glowing effect with increased width and opacity
            map.current!.setPaintProperty(visibleLayerId, "line-width", [
              "case",
              filter,
              8, // Increased width for hovered routes
              [
                "case",
                ["==", ["get", "overlapCount"], 1], 3,
                ["==", ["get", "overlapCount"], 2], 4,
                5 // Default for high overlap
              ]
            ]);
            
            map.current!.setPaintProperty(visibleLayerId, "line-opacity", [
              "case", 
              filter,
              1.0, // Full opacity for hovered routes
              [
                "case",
                ["==", ["get", "overlapCount"], 1], 0.6,
                ["==", ["get", "overlapCount"], 2], 0.8,
                0.9 // Default for high overlap
              ]
            ]);
            
            // Add glow effect with blur
            map.current!.setPaintProperty(visibleLayerId, "line-blur", [
              "case",
              filter,
              2, // Blur for glow effect on hovered routes
              0  // No blur for non-hovered routes
            ]);
          });
        }
      });

      map.current!.on("mouseleave", layerId, () => {
        if (map.current) {
          map.current.getCanvas().style.cursor = "";
        }
        
        // Reset all layers to original styling
        visibleLayerIds.forEach(visibleLayerId => {
          // Reset line width based on overlap count
          map.current!.setPaintProperty(visibleLayerId, "line-width", [
            "case",
            ["==", ["get", "overlapCount"], 1], 3,
            ["==", ["get", "overlapCount"], 2], 4,
            5 // High overlap
          ]);
          
          // Reset opacity based on overlap count
          map.current!.setPaintProperty(visibleLayerId, "line-opacity", [
            "case",
            ["==", ["get", "overlapCount"], 1], 0.6,
            ["==", ["get", "overlapCount"], 2], 0.8,
            0.9 // High overlap
          ]);
          
          // Remove blur effect
          map.current!.setPaintProperty(visibleLayerId, "line-blur", 0);
        });
      });
    });

  }, [fieldNotes, mapLoaded, theme]);

  return (
    <div className="relative w-full h-screen">
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Heat Map Legend */}
      {mapLoaded && fieldNotes.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-card/90 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-border">
          <h4 className="text-sm font-semibold text-foreground mb-3">Route Density</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-4 h-0.5" style={{ backgroundColor: getThemeColors().primary, opacity: 0.6 }}></div>
              <span className="text-xs text-muted-foreground">Low traffic</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-1" style={{ backgroundColor: getThemeColors().warning, opacity: 0.8 }}></div>
              <span className="text-xs text-muted-foreground">Medium traffic</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-1.5" style={{ backgroundColor: getThemeColors().destructive }}></div>
              <span className="text-xs text-muted-foreground">High traffic</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {fieldNotes.length} route{fieldNotes.length === 1 ? '' : 's'} aggregated
            </p>
          </div>
        </div>
      )}
      
      {fieldNotes.length === 0 && (
        <div className="absolute inset-0 bg-background flex items-center justify-center">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-foreground mb-2">No routes to display</h3>
            <p className="text-muted-foreground">Add some field notes with GPX data to see the heat map</p>
          </div>
        </div>
      )}
      
      {!mapLoaded && fieldNotes.length > 0 && (
        <div className="absolute inset-0 bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading heat map...</p>
          </div>
        </div>
      )}
    </div>
  );
}