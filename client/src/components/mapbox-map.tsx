import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initMapbox } from "@/lib/mapbox";
import { parseGpxData } from "@shared/gpx-utils";
import type { Photo } from "@shared/schema";
import type { ElevationPoint } from "@shared/gpx-utils";

interface MapboxMapProps {
  gpxData: any;
  photos: Photo[];
  onPhotoClick: (photoId: string) => void;
  hoveredElevationPoint?: ElevationPoint | null;
  hoveredPhotoId?: string | null;
  className?: string;
}

export default function MapboxMap({ 
  gpxData, 
  photos, 
  onPhotoClick, 
  hoveredElevationPoint, 
  hoveredPhotoId, 
  className 
}: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const elevationMarker = useRef<mapboxgl.Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const photoMarkers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const coordinatesRef = useRef<[number, number][]>([]);
  const [mapFocus, setMapFocus] = useState<'all' | 'track' | 'photos'>('all');
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

        // Calculate bounds to include both GPX track and photos
        const bounds = new mapboxgl.LngLatBounds();
        
        // Add GPX coordinates to bounds
        parsedGpxData.coordinates.forEach((coord: [number, number]) => {
          bounds.extend(coord);
        });
        
        // Add photo coordinates to bounds so map includes all markers
        if (photos && photos.length > 0) {
          photos.forEach((photo) => {
            if (photo.latitude && photo.longitude) {
              bounds.extend([photo.longitude, photo.latitude]);
            }
          });
        }
        
        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, { 
            padding: 50,
            duration: 0 // No animation
          });
        }
      }

      // Clear existing photo markers before adding new ones
      photoMarkers.current.forEach(marker => marker.remove());
      photoMarkers.current.clear();

      // Filter and number photos with valid GPS coordinates
      if (photos && photos.length > 0) {
        const geotaggedPhotos = photos
          .filter(photo => {
            // Strict validation: must be valid numbers, not null/undefined/NaN
            const lat = Number(photo.latitude);
            const lng = Number(photo.longitude);
            return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
          })
          .sort((a, b) => {
            // Sort by timestamp if available, otherwise keep original order
            if (a.timestamp && b.timestamp) {
              return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            }
            return 0;
          });

        geotaggedPhotos.forEach((photo, index) => {
          const photoNumber = index + 1;
          const lat = Number(photo.latitude);
          const lng = Number(photo.longitude);
          
          // Create simple numbered marker - completely static, no animations
          const markerEl = document.createElement('div');
          markerEl.className = 'photo-marker';
          markerEl.style.width = '28px';
          markerEl.style.height = '28px';
          markerEl.style.backgroundColor = '#0f62fe';
          markerEl.style.border = '2px solid white';
          markerEl.style.borderRadius = '50%';
          markerEl.style.cursor = 'pointer';
          markerEl.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.3)';
          markerEl.style.display = 'flex';
          markerEl.style.alignItems = 'center';
          markerEl.style.justifyContent = 'center';
          markerEl.style.color = 'white';
          markerEl.style.fontSize = '12px';
          markerEl.style.fontWeight = '700';
          markerEl.style.fontFamily = '-apple-system, BlinkMacSystemFont, sans-serif';
          markerEl.style.userSelect = 'none';
          markerEl.style.pointerEvents = 'auto';
          markerEl.textContent = String(photoNumber);
          
          // Simple click handler only
          markerEl.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (onPhotoClick) {
              onPhotoClick(photo.id);
            }
          };
          
          // Create marker with center anchor to prevent offset issues
          const marker = new mapboxgl.Marker({
            element: markerEl,
            anchor: 'center'
          })
            .setLngLat([lng, lat])
            .addTo(map.current!);
          
          photoMarkers.current.set(photo.id, marker);
        });
      }
    });

    return () => {
      // Clean up animation frames
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Clean up all photo markers
      photoMarkers.current.forEach(marker => marker.remove());
      photoMarkers.current.clear();
      
      if (elevationMarker.current) {
        elevationMarker.current.remove();
        elevationMarker.current = null;
      }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [gpxData, photos, onPhotoClick]);

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

  // Handle photo hover for map zoom - no marker transforms, only pan
  useEffect(() => {
    if (!map.current || !hoveredPhotoId) return;

    const hoveredPhoto = photos.find(p => p.id === hoveredPhotoId);
    if (hoveredPhoto && hoveredPhoto.latitude && hoveredPhoto.longitude) {
      // Smoothly pan to the hovered photo (no marker styling changes)
      map.current.flyTo({
        center: [hoveredPhoto.longitude, hoveredPhoto.latitude],
        zoom: Math.max(map.current.getZoom(), 16),
        duration: 800,
        essential: true
      });
    }
  }, [hoveredPhotoId, photos]);

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