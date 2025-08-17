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
  const photoMarkers = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const coordinatesRef = useRef<[number, number][]>([]);
  const [mapFocus, setMapFocus] = useState<'all' | 'track' | 'photos'>('all');

  // Initialize map and add GPX track
  useEffect(() => {
    if (!mapContainer.current) return;

    initMapbox();

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

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: initialCenter,
      zoom: initialZoom,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;

      // Debug logging for GPX data
      console.log('MapboxMap - parsedGpxData:', parsedGpxData);
      console.log('MapboxMap - coordinates length:', parsedGpxData?.coordinates?.length);

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

        // Create elevation position marker (initially hidden)
        const elevationEl = document.createElement('div');
        elevationEl.className = 'elevation-marker';
        elevationEl.style.cssText = `
          width: 12px;
          height: 12px;
          background: #ff3d3d;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(255, 61, 61, 0.4);
          transition: all 0.2s ease;
          display: none;
          z-index: 1000;
        `;

        elevationMarker.current = new mapboxgl.Marker(elevationEl)
          .setLngLat(parsedGpxData.coordinates[0])
          .addTo(map.current);

        // Calculate bounds to include both GPX track and photos
        const bounds = new mapboxgl.LngLatBounds();
        
        // Add GPX coordinates to bounds
        parsedGpxData.coordinates.forEach((coord: [number, number]) => {
          bounds.extend(coord);
        });
        
        // Photo coordinates no longer added to bounds since markers are removed
        
        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, { 
            padding: 50,
            duration: 0 // No animation
          });
        }
      }

      // Clear existing photo markers - removing photo indicators as requested
      photoMarkers.current.forEach(marker => marker.remove());
      photoMarkers.current.clear();

      // Photo markers removed - no longer displaying photo location indicators on map
    });

    return () => {
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

  // Handle elevation profile hover
  useEffect(() => {
    if (!map.current || !elevationMarker.current || !coordinatesRef.current.length) return;

    const markerEl = elevationMarker.current.getElement();
    
    if (hoveredElevationPoint && hoveredElevationPoint.coordinates) {
      // Use the coordinates directly from the ElevationPoint
      const [longitude, latitude] = hoveredElevationPoint.coordinates;
      
      // Show marker at the exact coordinates from the elevation point
      markerEl.style.display = 'block';
      markerEl.style.transform = 'scale(1.2)';
      
      elevationMarker.current.setLngLat([longitude, latitude]);
    } else {
      // Hide marker when not hovering
      markerEl.style.display = 'none';
    }
  }, [hoveredElevationPoint]);

  // Handle photo hover for map zoom
  useEffect(() => {
    if (!map.current || !hoveredPhotoId) return;

    const hoveredPhoto = photos.find(p => p.id === hoveredPhotoId);
    if (hoveredPhoto && hoveredPhoto.latitude && hoveredPhoto.longitude) {
      // Smoothly zoom to the hovered photo
      map.current.flyTo({
        center: [hoveredPhoto.longitude, hoveredPhoto.latitude],
        zoom: Math.max(map.current.getZoom(), 16),
        duration: 800,
        essential: true
      });

      // Highlight the hovered photo marker
      const marker = photoMarkers.current.get(hoveredPhotoId);
      if (marker) {
        const markerEl = marker.getElement().querySelector('.photo-marker') as HTMLElement;
        const labelEl = marker.getElement().querySelector('.photo-label') as HTMLElement;
        if (markerEl && labelEl) {
          markerEl.style.transform = 'scale(1.4)';
          markerEl.style.background = '#ff2200';
          markerEl.style.boxShadow = '0 6px 12px rgba(255, 34, 0, 0.5)';
          labelEl.style.opacity = '1';
        }
      }
    }

    return () => {
      // Reset highlighted marker when hover ends
      if (hoveredPhotoId) {
        const marker = photoMarkers.current.get(hoveredPhotoId);
        if (marker) {
          const markerEl = marker.getElement().querySelector('.photo-marker') as HTMLElement;
          const labelEl = marker.getElement().querySelector('.photo-label') as HTMLElement;
          if (markerEl && labelEl) {
            markerEl.style.transform = 'scale(1)';
            markerEl.style.background = '#ff6900';
            markerEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            labelEl.style.opacity = '0';
          }
        }
      }
    };
  }, [hoveredPhotoId, photos]);

  return (
    <div 
      ref={mapContainer}
      className={`bg-gray-100 ${className}`}
      data-testid="mapbox-map"
    />
  );
}