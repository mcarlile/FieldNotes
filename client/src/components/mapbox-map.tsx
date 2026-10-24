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

export interface PhotoMarker {
  id: string;
  latitude: number;
  longitude: number;
  url?: string;
}

interface MapboxMapProps {
  gpxData?: any;
  // Pre-parsed coordinate array — alternative to gpxData
  coordinates?: [number, number][];
  hoveredElevationPoint?: ElevationPoint | null;
  clipMarkers?: ClipMarker[];
  photoMarkers?: PhotoMarker[];
  className?: string;
  height?: string;
}

export default function MapboxMap({
  gpxData,
  coordinates: coordinatesProp,
  hoveredElevationPoint,
  clipMarkers,
  photoMarkers,
  className,
  height,
}: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const elevationMarker = useRef<mapboxgl.Marker | null>(null);
  const clipMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const photoMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
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

    // Parse GPX data or use pre-parsed coordinates
    let parsedGpxData: any = null;
    if (coordinatesProp && coordinatesProp.length > 0) {
      parsedGpxData = { coordinates: coordinatesProp };
    } else if (gpxData) {
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
          width: 14px;
          height: 14px;
          background: #1a1815;
          border: 2px solid #f4f1ec;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(14, 13, 11, 0.45);
          opacity: 0;
          transform: scale(0.5);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          z-index: 1000;
          position: relative;
        `;
        
        // Subtle ink-colored pulsing ring
        const ringEl = document.createElement('div');
        ringEl.className = 'elevation-ring';
        ringEl.style.cssText = `
          position: absolute;
          top: -7px;
          left: -7px;
          width: 26px;
          height: 26px;
          border: 1.5px solid rgba(26, 24, 21, 0.35);
          border-radius: 50%;
          opacity: 0;
          transform: scale(0.8);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
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
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (elevationMarker.current) {
        elevationMarker.current.remove();
        elevationMarker.current = null;
      }
      photoMarkersRef.current.forEach(m => m.remove());
      photoMarkersRef.current.clear();
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [gpxData, coordinatesProp]);

  // Handle elevation profile hover with immediate, responsive updates
  useEffect(() => {
    if (!map.current || !elevationMarker.current || !coordinatesRef.current.length) return;

    const markerEl = elevationMarker.current.getElement();
    const ringEl = markerEl.querySelector('.elevation-ring') as HTMLElement;

    if (hoveredElevationPoint && hoveredElevationPoint.coordinates) {
      const [longitude, latitude] = hoveredElevationPoint.coordinates;

      // Guard: skip obviously invalid coordinates (0,0 is the Gulf of Guinea)
      if (longitude === 0 && latitude === 0) return;

      // Immediate position update for responsive sync
      elevationMarker.current.setLngLat([longitude, latitude]);
      
      // Show marker with immediate appearance
      markerEl.style.opacity = '1';
      markerEl.style.transform = 'scale(1.1)';
      markerEl.style.boxShadow = '0 4px 14px rgba(14, 13, 11, 0.55), 0 0 0 6px rgba(26, 24, 21, 0.08)';
      
      // Animate the ring
      if (ringEl) {
        ringEl.style.opacity = '1';
        ringEl.style.transform = 'scale(1)';
      }
    } else {
      // Hide marker immediately
      markerEl.style.opacity = '0';
      markerEl.style.transform = 'scale(0.5)';
      markerEl.style.boxShadow = '0 2px 8px rgba(14, 13, 11, 0.45)';
      
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

  // Handle photo markers
  useEffect(() => {
    if (!map.current) return;

    const addPhotoMarkers = () => {
      if (!map.current) return;

      const currentIds = new Set(photoMarkers?.map(m => m.id) || []);

      // Remove stale markers
      photoMarkersRef.current.forEach((marker, id) => {
        if (!currentIds.has(id)) {
          marker.remove();
          photoMarkersRef.current.delete(id);
        }
      });

      photoMarkers?.forEach((pm) => {
        if (photoMarkersRef.current.has(pm.id)) {
          photoMarkersRef.current.get(pm.id)?.setLngLat([pm.longitude, pm.latitude]);
          return;
        }

        const el = document.createElement('div');
        el.style.cssText = `
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid #fff;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
          cursor: pointer;
          overflow: hidden;
          background: #e8e4de;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        `;

        if (pm.url) {
          const img = document.createElement('img');
          const src = pm.url.startsWith('http') || pm.url.startsWith('//')
            ? pm.url
            : `${window.location.origin}${pm.url.startsWith('/') ? '' : '/'}${pm.url}`;
          img.src = src;
          img.style.cssText = `width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none;`;
          img.onerror = () => { img.style.display = 'none'; };
          el.appendChild(img);
        } else {
          // Simple dot when no photo URL
          el.style.background = '#1a1815';
          el.style.width = '10px';
          el.style.height = '10px';
          el.style.border = '2px solid #f4f1ec';
        }

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([pm.longitude, pm.latitude])
          .addTo(map.current!);

        photoMarkersRef.current.set(pm.id, marker);
      });
    };

    if (!map.current.loaded()) {
      map.current.on('load', addPhotoMarkers);
      return () => { map.current?.off('load', addPhotoMarkers); };
    }

    addPhotoMarkers();
  }, [photoMarkers]);

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
      className={`bg-gray-100 ${className ?? ''}`}
      style={height ? { height } : undefined}
      data-testid="mapbox-map"
    />
  );
}