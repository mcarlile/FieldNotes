import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initMapbox } from "@/lib/mapbox";
import { parseGpxData } from "@shared/gpx-utils";
import type { ElevationPoint } from "@shared/gpx-utils";

export interface ClipMarker {
  id: string;
  type: 'start' | 'end';
  latitude: number;
  longitude: number;
  color?: string;
}

interface MapboxMapProps {
  gpxData: any;
  hoveredElevationPoint?: ElevationPoint | null;
  clipMarkers?: ClipMarker[];
  className?: string;
}

export default function MapboxMap({ 
  gpxData, 
  hoveredElevationPoint, 
  clipMarkers,
  className 
}: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const elevationMarker = useRef<mapboxgl.Marker | null>(null);
  const clipMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const coordinatesRef = useRef<[number, number][]>([]);
  const [webglError, setWebglError] = useState(false);

  // Initialize map and add GPX track
  useEffect(() => {
    if (!mapContainer.current) return;

    // Check for WebGL support first
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      setWebglError(true);
      return;
    }

    try {
      initMapbox();
    } catch (error) {
      console.warn('Mapbox initialization error:', error);
      setWebglError(true);
      return;
    }

    // Parse GPX data if it's a string
    let parsedGpxData: any = null;
    if (gpxData) {
      try {
        if (typeof gpxData === 'string') {
          parsedGpxData = parseGpxData(gpxData);
        } else if (typeof gpxData === 'object' && gpxData.coordinates) {
          parsedGpxData = gpxData;
        }
      } catch (error) {
        console.error('Failed to parse GPX data:', error);
      }
    }

    // Store coordinates for elevation marker positioning
    if (parsedGpxData && parsedGpxData.coordinates) {
      coordinatesRef.current = parsedGpxData.coordinates;
    }

    // Calculate initial center and zoom from GPX data
    let initialCenter: [number, number] = [-74.006, 40.7128];
    let initialZoom = 12;
    
    if (parsedGpxData && parsedGpxData.coordinates && parsedGpxData.coordinates.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      parsedGpxData.coordinates.forEach((coord: [number, number]) => {
        bounds.extend(coord);
      });
      
      if (!bounds.isEmpty()) {
        initialCenter = bounds.getCenter().toArray() as [number, number];
        
        // Calculate appropriate zoom level for the bounds
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const latSpan = ne.lat - sw.lat;
        const lngSpan = ne.lng - sw.lng;
        const maxSpan = Math.max(latSpan, lngSpan);
        
        if (maxSpan > 10) initialZoom = 4;
        else if (maxSpan > 5) initialZoom = 6;
        else if (maxSpan > 1) initialZoom = 8;
        else if (maxSpan > 0.5) initialZoom = 10;
        else if (maxSpan > 0.1) initialZoom = 12;
        else initialZoom = 14;
      }
    }

    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: initialCenter,
        zoom: initialZoom,
      });
    } catch (error) {
      console.warn('Failed to create Mapbox map:', error);
      setWebglError(true);
      return;
    }

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;

      // Add GPX track if available
      if (parsedGpxData && parsedGpxData.coordinates && parsedGpxData.coordinates.length > 0) {
        const geojsonData = {
          type: 'FeatureCollection' as const,
          features: [{
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: parsedGpxData.coordinates
            }
          }]
        };

        map.current.addSource('gpx-track', {
          type: 'geojson',
          data: geojsonData,
        });

        map.current.addLayer({
          id: 'gpx-track-line',
          type: 'line',
          source: 'gpx-track',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#0f62fe',
            'line-width': 3,
          },
        });

        // Create elevation position marker with smooth animations
        const elevationEl = document.createElement('div');
        elevationEl.className = 'elevation-marker';
        elevationEl.style.cssText = `
          width: 16px;
          height: 16px;
          background: radial-gradient(circle, #ff3d3d 0%, #ff6b6b 100%);
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 4px 12px rgba(255, 61, 61, 0.4), 0 0 0 0 rgba(255, 61, 61, 0.3);
          opacity: 0;
          transform: scale(0.5);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          z-index: 1000;
          position: relative;
        `;
        
        // Add a pulsing ring animation
        const ringEl = document.createElement('div');
        ringEl.className = 'elevation-ring';
        ringEl.style.cssText = `
          position: absolute;
          top: -6px;
          left: -6px;
          width: 28px;
          height: 28px;
          border: 2px solid rgba(255, 61, 61, 0.4);
          border-radius: 50%;
          opacity: 0;
          transform: scale(0.8);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          animation: pulse-ring 2s infinite;
        `;
        
        elevationEl.appendChild(ringEl);

        elevationMarker.current = new mapboxgl.Marker(elevationEl)
          .setLngLat(parsedGpxData.coordinates[0])
          .addTo(map.current);

        // Calculate bounds for GPX track
        const bounds = new mapboxgl.LngLatBounds();
        
        // Add GPX coordinates to bounds
        parsedGpxData.coordinates.forEach((coord: [number, number]) => {
          bounds.extend(coord);
        });
        
        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, { 
            padding: 50,
            duration: 0 // No animation
          });
        }
      }
    });

    return () => {
      // Clean up animation frames
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (elevationMarker.current) {
        elevationMarker.current.remove();
        elevationMarker.current = null;
      }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [gpxData]);

  // Handle elevation profile hover with immediate, responsive updates
  useEffect(() => {
    if (!map.current || !elevationMarker.current || !coordinatesRef.current.length) return;

    const markerEl = elevationMarker.current.getElement();
    const ringEl = markerEl.querySelector('.elevation-ring') as HTMLElement;
    
    if (hoveredElevationPoint && hoveredElevationPoint.coordinates) {
      // Use the coordinates directly from the ElevationPoint
      const [longitude, latitude] = hoveredElevationPoint.coordinates;
      
      // Immediate position update for responsive sync
      elevationMarker.current.setLngLat([longitude, latitude]);
      
      // Show marker with immediate appearance
      markerEl.style.opacity = '1';
      markerEl.style.transform = 'scale(1.1)';
      markerEl.style.boxShadow = '0 6px 16px rgba(255, 61, 61, 0.6), 0 0 0 8px rgba(255, 61, 61, 0.1)';
      
      // Animate the ring
      if (ringEl) {
        ringEl.style.opacity = '1';
        ringEl.style.transform = 'scale(1)';
      }
    } else {
      // Hide marker immediately
      markerEl.style.opacity = '0';
      markerEl.style.transform = 'scale(0.5)';
      markerEl.style.boxShadow = '0 4px 12px rgba(255, 61, 61, 0.4), 0 0 0 0 rgba(255, 61, 61, 0.3)';
      
      // Hide the ring
      if (ringEl) {
        ringEl.style.opacity = '0';
        ringEl.style.transform = 'scale(0.8)';
      }
    }
  }, [hoveredElevationPoint]);

  // Handle clip markers for start/end points
  useEffect(() => {
    if (!map.current) return;

    // Wait for map to be loaded
    if (!map.current.loaded()) {
      const onLoad = () => {
        updateClipMarkers();
      };
      map.current.on('load', onLoad);
      return () => {
        map.current?.off('load', onLoad);
      };
    }

    updateClipMarkers();

    function updateClipMarkers() {
      if (!map.current) return;

      // Remove old markers that are no longer needed
      const currentMarkerIds = new Set(clipMarkers?.map(m => `${m.id}-${m.type}`) || []);
      clipMarkersRef.current.forEach((marker, key) => {
        if (!currentMarkerIds.has(key)) {
          marker.remove();
          clipMarkersRef.current.delete(key);
        }
      });

      // Add or update markers
      clipMarkers?.forEach((clipMarker) => {
        const markerId = `${clipMarker.id}-${clipMarker.type}`;
        
        if (clipMarkersRef.current.has(markerId)) {
          // Update existing marker position
          clipMarkersRef.current.get(markerId)?.setLngLat([clipMarker.longitude, clipMarker.latitude]);
        } else {
          // Create new marker
          const markerEl = document.createElement('div');
          const isStart = clipMarker.type === 'start';
          const markerColor = clipMarker.color || (isStart ? '#10b981' : '#ef4444');
          
          markerEl.style.cssText = `
            width: 20px;
            height: 20px;
            background: ${markerColor};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            cursor: pointer;
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
          `;
          
          // Add inner icon
          const innerEl = document.createElement('div');
          innerEl.style.cssText = `
            color: white;
            font-size: 10px;
            font-weight: bold;
          `;
          innerEl.textContent = isStart ? 'S' : 'E';
          markerEl.appendChild(innerEl);
          
          const marker = new mapboxgl.Marker(markerEl)
            .setLngLat([clipMarker.longitude, clipMarker.latitude])
            .addTo(map.current!);
          
          clipMarkersRef.current.set(markerId, marker);
        }
      });
    }

    return () => {
      // Cleanup is handled in the main useEffect for map initialization
    };
  }, [clipMarkers]);

  // Show fallback UI if WebGL is not supported
  if (webglError) {
    return (
      <div 
        className={`bg-muted flex items-center justify-center ${className}`}
        data-testid="mapbox-map-fallback"
      >
        <div className="text-center p-6">
          <div className="text-muted-foreground text-sm">
            Map preview unavailable
          </div>
          <div className="text-muted-foreground text-xs mt-1">
            WebGL is required for interactive maps
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={mapContainer}
      className={`bg-gray-100 ${className}`}
      data-testid="mapbox-map"
    />
  );
}