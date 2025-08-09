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

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [-74.006, 40.7128], // Default to NYC if no data
      zoom: 12,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.current.on('load', () => {
      if (!map.current) return;

      // Add GPX track if available
      if (gpxData && gpxData.coordinates && gpxData.coordinates.length > 0) {
        const geojsonData = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
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

        // Fit map to GPX bounds
        const bounds = new mapboxgl.LngLatBounds();
        gpxData.coordinates.forEach((coord: [number, number]) => {
          bounds.extend(coord);
        });
        
        if (!bounds.isEmpty()) {
          map.current.fitBounds(bounds, { padding: 50 });
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
