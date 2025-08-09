import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { FieldNote } from "@shared/schema";

interface MapboxRoutePreviewProps {
  fieldNote: FieldNote;
  className?: string;
}

export default function MapboxRoutePreview({ fieldNote, className = "" }: MapboxRoutePreviewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || !fieldNote.gpxData || !('coordinates' in fieldNote.gpxData)) return;

    // Initialize the map only once
    if (!map.current) {
      mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: [0, 0],
        zoom: 1,
        interactive: false, // Disable interactions for preview
        attributionControl: false,
        logoPosition: 'top-right'
      });

      map.current.on('load', () => {
        if (!map.current || !fieldNote.gpxData || !('coordinates' in fieldNote.gpxData)) return;

        const coordinates = (fieldNote.gpxData as any).coordinates as [number, number][];
        
        // Add the route line
        map.current.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coordinates
            }
          }
        });

        map.current.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#0f62fe', // IBM Blue
            'line-width': 3
          }
        });

        // Fit the map to the route bounds
        if (coordinates.length > 0) {
          const bounds = coordinates.reduce((bounds, coord) => {
            return bounds.extend(coord);
          }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
          
          map.current.fitBounds(bounds, {
            padding: 20,
            maxZoom: 14
          });
        }
      });
    }

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [fieldNote.gpxData]);

  if (!fieldNote.gpxData || !('coordinates' in fieldNote.gpxData)) {
    return (
      <div className={`bg-carbon-gray-20 flex items-center justify-center text-carbon-gray-70 text-sm font-ibm ${className}`}>
        No Route Data
      </div>
    );
  }

  return (
    <div 
      ref={mapContainer}
      className={`bg-carbon-gray-20 ${className}`}
      data-testid="mapbox-route-preview"
    />
  );
}