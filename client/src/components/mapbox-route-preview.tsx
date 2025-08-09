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
      
      const coordinates = (fieldNote.gpxData as any).coordinates as [number, number][];
      
      // Calculate initial bounds and center
      let initialCenter: [number, number] = [0, 0];
      let initialZoom = 1;
      
      if (coordinates.length > 0) {
        const bounds = coordinates.reduce((bounds, coord) => {
          return bounds.extend(coord);
        }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
        
        initialCenter = bounds.getCenter().toArray() as [number, number];
        
        // Calculate appropriate zoom level for the bounds
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const maxZoom = 14;
        
        // Simple zoom calculation based on coordinate span
        const latSpan = ne.lat - sw.lat;
        const lngSpan = ne.lng - sw.lng;
        const maxSpan = Math.max(latSpan, lngSpan);
        
        if (maxSpan > 10) initialZoom = 4;
        else if (maxSpan > 5) initialZoom = 6;
        else if (maxSpan > 1) initialZoom = 8;
        else if (maxSpan > 0.5) initialZoom = 10;
        else if (maxSpan > 0.1) initialZoom = 12;
        else initialZoom = maxZoom;
      }
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: initialCenter,
        zoom: initialZoom,
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

        // Fine-tune the bounds fit without animation
        if (coordinates.length > 0) {
          const bounds = coordinates.reduce((bounds, coord) => {
            return bounds.extend(coord);
          }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
          
          map.current.fitBounds(bounds, {
            padding: 20,
            maxZoom: 14,
            duration: 0 // No animation
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