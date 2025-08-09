import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { initMapbox } from "@/lib/mapbox";
import type { Photo } from "@shared/schema";

interface MapboxMapProps {
  gpxData: any;
  photos: Photo[];
  onPhotoClick: (photoId: string) => void;
}

export default function MapboxMap({ gpxData, photos, onPhotoClick }: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    initMapbox();

    // Calculate initial center and zoom from GPX data
    let initialCenter: [number, number] = [-74.006, 40.7128];
    let initialZoom = 12;
    
    if (gpxData && gpxData.coordinates && gpxData.coordinates.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      gpxData.coordinates.forEach((coord: [number, number]) => {
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

      // Add GPX track if available
      if (gpxData && gpxData.coordinates && gpxData.coordinates.length > 0) {
        const geojsonData = {
          type: 'FeatureCollection' as const,
          features: [{
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: gpxData.coordinates
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

        // Fine-tune bounds without animation
        const bounds = new mapboxgl.LngLatBounds();
        gpxData.coordinates.forEach((coord: [number, number]) => {
          bounds.extend(coord);
        });
        
        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, { 
            padding: 50,
            duration: 0 // No animation
          });
        }
      }

      // Add photo markers
      photos.forEach((photo) => {
        if (photo.latitude && photo.longitude && map.current) {
          const el = document.createElement('div');
          el.className = 'photo-marker';
          el.style.cssText = `
            width: 12px;
            height: 12px;
            background: #0f62fe;
            border: 2px solid white;
            border-radius: 50%;
            cursor: pointer;
            transition: transform 0.15s ease;
          `;
          
          el.addEventListener('mouseenter', () => {
            el.style.transform = 'scale(1.5)';
            el.style.background = '#ff6900';
          });
          
          el.addEventListener('mouseleave', () => {
            el.style.transform = 'scale(1)';
            el.style.background = '#0f62fe';
          });
          
          el.addEventListener('click', () => {
            onPhotoClick(photo.id);
          });

          new mapboxgl.Marker(el)
            .setLngLat([photo.longitude, photo.latitude])
            .addTo(map.current);
        }
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, [gpxData, photos, onPhotoClick]);

  return (
    <div 
      ref={mapContainer} 
      className="w-full h-96 bg-carbon-gray-20"
      style={{ minHeight: '400px' }}
    />
  );
}
