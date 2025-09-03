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
  const [highlightedDensity, setHighlightedDensity] = useState<string | null>(null);
  const [is3DMode, setIs3DMode] = useState(true);

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

    // Initialize map with subtle 3D perspective by default
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v11",
      center: [-120.2, 39.3], // Default center (Tahoe area)
      zoom: 10,
      pitch: 35, // Start with subtle 3D tilt
      bearing: -12, // Slight rotation for dynamic view
    });

    map.current.on("load", () => {
      // Enable 3D terrain by default since is3DMode starts as true
      if (map.current) {
        // Add terrain source for 3D mode
        map.current.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        });

        // Use a small delay to ensure style is fully loaded
        setTimeout(() => {
          if (map.current && map.current.isStyleLoaded()) {
            // Set terrain with subtle elevation (default 3D mode)
            map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
            
            // Add atmospheric sky layer
            if (!map.current.getLayer('sky')) {
              map.current.addLayer({
                id: 'sky',
                type: 'sky',
                paint: {
                  'sky-type': 'atmosphere',
                  'sky-atmosphere-sun': [0.0, 0.0],
                  'sky-atmosphere-sun-intensity': 15
                }
              }, 'water');
            }
          }
        }, 100);
      }
      setMapLoaded(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Handle 3D mode toggle
  const toggle3DMode = () => {
    if (!map.current) return;
    
    const newIs3DMode = !is3DMode;
    setIs3DMode(newIs3DMode);
    
    if (newIs3DMode) {
      // Enable 3D mode
      map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      
      // Add sky layer first (background)
      if (!map.current.getLayer('sky')) {
        map.current.addLayer({
          id: 'sky',
          type: 'sky',
          paint: {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 0.0],
            'sky-atmosphere-sun-intensity': 15
          }
        }, 'water'); // Insert before water layer to keep it in background
      }
      
      // Ensure route layers are above terrain by moving them to top
      const routeLayers = ['route-heat-single', 'route-heat-medium', 'route-heat-high', 'route-heat'];
      routeLayers.forEach(layerId => {
        if (map.current && map.current.getLayer(layerId)) {
          // Move route layers to top to ensure they render above terrain
          map.current.moveLayer(layerId);
        }
      });
      
      // Animate to subtle 3D perspective
      map.current.easeTo({
        pitch: 35,
        bearing: -12,
        duration: 1000
      });
    } else {
      // Disable 3D mode
      map.current.setTerrain(null);
      if (map.current.getLayer('sky')) {
        map.current.removeLayer('sky');
      }
      
      // Animate back to 2D view
      map.current.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 1000
      });
    }
  };

  useEffect(() => {
    if (!map.current || !mapLoaded || fieldNotes.length === 0) return;

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

    // If 3D mode is active, move all route layers to top to ensure visibility above terrain
    if (is3DMode) {
      const routeLayers = ['route-heat-single', 'route-heat-medium', 'route-heat-high'];
      routeLayers.forEach(layerId => {
        if (map.current && map.current.getLayer(layerId)) {
          map.current.moveLayer(layerId);
        }
      });
    }

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

      // Collect ALL unique route IDs from ALL clicked features (not just the first one)
      const allRouteIds = new Set<string>();
      let maxOverlapCount = 0;

      clickedFeatures.forEach(feature => {
        const overlapCount = feature.properties?.overlapCount || 1;
        maxOverlapCount = Math.max(maxOverlapCount, overlapCount);
        
        // Get route IDs from this feature
        const routeIds = feature.properties?.routeIds;
        const noteId = feature.properties?.noteId;
        
        if (Array.isArray(routeIds)) {
          routeIds.forEach(id => allRouteIds.add(id));
        } else if (noteId) {
          allRouteIds.add(noteId);
        }
      });

      // Convert Set to Array and find all intersecting notes
      const routeIdArray = Array.from(allRouteIds);
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
             <strong>${intersectingNotes.length} Routes Overlap Here:</strong><br/>
             ${intersectingNotes.filter(note => note).map(note => 
               `<div class="mt-2 pl-2 border-l-2" style="border-color: ${colors.warning};">
                  <a href="/field-notes/${note!.id}" class="font-semibold underline" style="color: ${colors.primary}; text-decoration: underline;">
                    ${note!.title}
                  </a><br/>
                  <span class="text-xs" style="color: #6b7280;">${note!.tripType} • ${note!.distance}mi</span>
                </div>`
             ).join('')}
             <div class="mt-2 text-xs" style="color: ${colors.primary};">Tap any route to view details</div>
           </div>`;

      activePopup = new mapboxgl.Popup({ 
        closeButton: true, 
        closeOnClick: false,
        maxWidth: "350px"
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

  // Handle density highlighting functionality
  const handleDensityHighlight = (density: string) => {
    if (!map.current) return;
    
    if (highlightedDensity === density) {
      // Toggle off if already selected
      setHighlightedDensity(null);
      // Reset all layer opacities
      const allLayers = ["route-heat-single", "route-heat-medium", "route-heat-high"];
      allLayers.forEach(layerId => {
        if (map.current && map.current.getLayer(layerId)) {
          map.current.setPaintProperty(layerId, "line-opacity", 
            layerId === "route-heat-single" ? 0.7 : layerId === "route-heat-medium" ? 0.8 : 0.9
          );
        }
      });
    } else {
      // Highlight selected density
      setHighlightedDensity(density);
      
      // Dim all layers first
      const allLayers = ["route-heat-single", "route-heat-medium", "route-heat-high"];
      allLayers.forEach(layerId => {
        if (map.current && map.current.getLayer(layerId)) {
          map.current.setPaintProperty(layerId, "line-opacity", 0.2);
        }
      });
      
      // Highlight the selected density layer
      const targetLayer = 
        density === 'low' ? "route-heat-single" :
        density === 'medium' ? "route-heat-medium" : 
        "route-heat-high";
        
      if (map.current.getLayer(targetLayer)) {
        map.current.setPaintProperty(targetLayer, "line-opacity", 1);
      }
    }
  };

  return (
    <div className="relative w-full h-screen">
      {/* 3D Mode Toggle */}
      <div className="absolute top-4 right-4 z-10 bg-card border border-border rounded-lg p-3 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">3D View</span>
          <button
            onClick={toggle3DMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              is3DMode ? 'bg-primary' : 'bg-muted'
            }`}
            aria-label="Toggle 3D mode"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                is3DMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
      
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Animated Heat Map Legend */}
      {mapLoaded && fieldNotes.length > 0 && (
        <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-border transition-all duration-300 hover:shadow-xl hover:scale-105 hover:bg-card">
          <h4 className="text-sm font-semibold text-foreground mb-3 transition-colors duration-200">Route Density</h4>
          <div className="space-y-3">
            {/* Low Traffic */}
            <div 
              className={`flex items-center gap-3 group cursor-pointer transition-all duration-200 hover:scale-105 hover:translate-x-1 p-2 rounded-md ${highlightedDensity === 'low' ? 'bg-primary/10 ring-2 ring-primary/30' : 'hover:bg-muted/50'}`}
              onClick={() => handleDensityHighlight('low')}
            >
              <div className="relative">
                <div 
                  className={`w-4 h-0.5 rounded-full transition-all duration-300 group-hover:w-6 group-hover:h-1 group-hover:shadow-lg ${highlightedDensity === 'low' ? 'w-6 h-1 shadow-lg' : ''}`}
                  style={{ 
                    backgroundColor: getThemeColors().primary, 
                    opacity: highlightedDensity === 'low' ? 1 : 0.6,
                    boxShadow: highlightedDensity === 'low' ? `0 0 12px ${getThemeColors().primary}60` : `0 0 8px ${getThemeColors().primary}40`
                  }}
                ></div>
                <div 
                  className={`absolute inset-0 w-4 h-0.5 rounded-full transition-opacity duration-300 ${highlightedDensity === 'low' ? 'opacity-100 animate-pulse' : 'opacity-0 group-hover:opacity-100 animate-pulse'}`}
                  style={{ 
                    backgroundColor: getThemeColors().primary,
                    filter: 'blur(2px)'
                  }}
                ></div>
              </div>
              <span className={`text-xs transition-colors duration-200 ${highlightedDensity === 'low' ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}>
                Low traffic
              </span>
            </div>

            {/* Medium Traffic */}
            <div 
              className={`flex items-center gap-3 group cursor-pointer transition-all duration-200 hover:scale-105 hover:translate-x-1 p-2 rounded-md ${highlightedDensity === 'medium' ? 'bg-warning/10 ring-2 ring-warning/30' : 'hover:bg-muted/50'}`}
              onClick={() => handleDensityHighlight('medium')}
            >
              <div className="relative">
                <div 
                  className={`w-4 h-1 rounded-full transition-all duration-300 group-hover:w-6 group-hover:h-1.5 group-hover:shadow-lg ${highlightedDensity === 'medium' ? 'w-6 h-1.5 shadow-lg' : ''}`}
                  style={{ 
                    backgroundColor: getThemeColors().warning, 
                    opacity: highlightedDensity === 'medium' ? 1 : 0.8,
                    boxShadow: highlightedDensity === 'medium' ? `0 0 12px ${getThemeColors().warning}60` : `0 0 8px ${getThemeColors().warning}40`
                  }}
                ></div>
                <div 
                  className={`absolute inset-0 w-4 h-1 rounded-full transition-opacity duration-300 ${highlightedDensity === 'medium' ? 'opacity-100 animate-pulse' : 'opacity-0 group-hover:opacity-100 animate-pulse'}`}
                  style={{ 
                    backgroundColor: getThemeColors().warning,
                    filter: 'blur(2px)'
                  }}
                ></div>
              </div>
              <span className={`text-xs transition-colors duration-200 ${highlightedDensity === 'medium' ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}>
                Medium traffic
              </span>
            </div>

            {/* High Traffic */}
            <div 
              className={`flex items-center gap-3 group cursor-pointer transition-all duration-200 hover:scale-105 hover:translate-x-1 p-2 rounded-md ${highlightedDensity === 'high' ? 'bg-destructive/10 ring-2 ring-destructive/30' : 'hover:bg-muted/50'}`}
              onClick={() => handleDensityHighlight('high')}
            >
              <div className="relative">
                <div 
                  className={`w-4 h-1.5 rounded-full transition-all duration-300 group-hover:w-6 group-hover:h-2 group-hover:shadow-lg ${highlightedDensity === 'high' ? 'w-6 h-2 shadow-lg' : ''}`}
                  style={{ 
                    backgroundColor: getThemeColors().destructive,
                    opacity: highlightedDensity === 'high' ? 1 : 0.9,
                    boxShadow: highlightedDensity === 'high' ? `0 0 12px ${getThemeColors().destructive}60` : `0 0 8px ${getThemeColors().destructive}40`
                  }}
                ></div>
                <div 
                  className={`absolute inset-0 w-4 h-1.5 rounded-full transition-opacity duration-300 ${highlightedDensity === 'high' ? 'opacity-100 animate-pulse' : 'opacity-0 group-hover:opacity-100 animate-pulse'}`}
                  style={{ 
                    backgroundColor: getThemeColors().destructive,
                    filter: 'blur(2px)'
                  }}
                ></div>
              </div>
              <span className={`text-xs transition-colors duration-200 ${highlightedDensity === 'high' ? 'text-foreground font-medium' : 'text-muted-foreground group-hover:text-foreground'}`}>
                High traffic
              </span>
            </div>
          </div>
          
          <div className="mt-4 pt-3 border-t border-border transition-colors duration-200">
            <p className="text-xs text-muted-foreground transition-colors duration-200">
              {fieldNotes.length} route{fieldNotes.length === 1 ? '' : 's'} aggregated
            </p>
            <div className="mt-2 flex gap-1 items-center">
              {Array.from({ length: Math.min(fieldNotes.length, 5) }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 h-1 rounded-full bg-primary animate-pulse"
                  style={{ 
                    animationDelay: `${i * 200}ms`,
                    animationDuration: '2s'
                  }}
                ></div>
              ))}
              {fieldNotes.length > 5 && (
                <span className="text-xs text-muted-foreground ml-1">+{fieldNotes.length - 5}</span>
              )}
              {highlightedDensity && (
                <button
                  onClick={() => setHighlightedDensity(null)}
                  className="ml-auto text-xs text-primary hover:text-foreground transition-colors duration-200 underline"
                >
                  Show all
                </button>
              )}
            </div>
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