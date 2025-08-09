import { useState, lazy, Suspense } from "react";
import { Button } from "@carbon/react";
import { Maximize, View, Close } from "@carbon/icons-react";
import type { Photo } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";

// Lazy load the MapboxMap component
const MapboxMap = lazy(() => import('./mapbox-map'));

interface FullScreenMapModalProps {
  gpxData: unknown;
  photos: Photo[];
  onPhotoClick?: (photoId: string) => void;
  onClose: () => void;
}

function FullScreenMapModal({ gpxData, photos, onPhotoClick, onClose }: FullScreenMapModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-white">
      {/* Header with close button */}
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <h2 className="text-lg font-semibold text-gray-900">Interactive Map</h2>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Close}
          onClick={onClose}
          className="flex items-center gap-2"
          data-testid="button-close-map"
        >
          Close Map
        </Button>
      </div>
      
      {/* Full-screen map */}
      <div className="h-[calc(100vh-5rem)]">
        <Suspense fallback={
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading interactive map...</p>
            </div>
          </div>
        }>
          <MapboxMap
            gpxData={gpxData}
            photos={photos}
            onPhotoClick={onPhotoClick}
            className="w-full h-full"
          />
        </Suspense>
      </div>
    </div>
  );
}

interface MapPreviewProps {
  gpxData: unknown;
  photos: Photo[];
  onPhotoClick?: (photoId: string) => void;
  className?: string;
}

export default function MapPreview({ gpxData, photos, onPhotoClick, className = "" }: MapPreviewProps) {
  const [showFullMap, setShowFullMap] = useState(false);

  // Parse GPX data to get coordinates for preview
  const coordinates = (() => {
    try {
      if (typeof gpxData === 'string') {
        const stats = parseGpxData(gpxData);
        return stats.coordinates;
      } else if (gpxData && typeof gpxData === 'object' && 'coordinates' in gpxData) {
        return (gpxData as any).coordinates;
      }
      return [];
    } catch (error) {
      console.error('Failed to parse GPX data:', error);
      return [];
    }
  })();
  const hasValidTrack = coordinates && coordinates.length > 0;

  // Calculate bounds for preview image using all coordinates
  const getBounds = () => {
    if (!hasValidTrack) return null;
    
    const lats = coordinates.map((coord: number[]) => coord[1]);
    const lngs = coordinates.map((coord: number[]) => coord[0]);
    
    const bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs)
    };
    
    // Ensure bounds are valid
    if (bounds.minLat === bounds.maxLat) {
      bounds.minLat -= 0.001;
      bounds.maxLat += 0.001;
    }
    if (bounds.minLng === bounds.maxLng) {
      bounds.minLng -= 0.001;
      bounds.maxLng += 0.001;
    }
    
    return bounds;
  };

  const bounds = getBounds();

  // Generate static map preview URL using Mapbox Static API
  const getStaticMapUrl = () => {
    if (!bounds || !hasValidTrack) {
      console.log('No bounds or invalid track:', { bounds, hasValidTrack, coordinatesLength: coordinates.length });
      return null;
    }
    
    const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!accessToken) {
      console.error('VITE_MAPBOX_ACCESS_TOKEN not found');
      return null;
    }

    // Calculate center and zoom level
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const centerLng = (bounds.minLng + bounds.maxLng) / 2;
    
    // Calculate zoom to fit the entire route with padding
    const latDiff = bounds.maxLat - bounds.minLat;
    const lngDiff = bounds.maxLng - bounds.minLng;
    
    // Add padding around the route (20% on each side)
    const latPadding = latDiff * 0.2;
    const lngPadding = lngDiff * 0.2;
    
    const paddedLatDiff = latDiff + (latPadding * 2);
    const paddedLngDiff = lngDiff + (lngPadding * 2);
    
    // Calculate zoom based on the larger dimension to ensure entire route fits
    const maxDiff = Math.max(paddedLatDiff, paddedLngDiff);
    
    // More conservative zoom calculation to ensure full route visibility
    let zoom;
    if (maxDiff > 0.1) zoom = 10;
    else if (maxDiff > 0.05) zoom = 11;
    else if (maxDiff > 0.02) zoom = 12;
    else if (maxDiff > 0.01) zoom = 13;
    else if (maxDiff > 0.005) zoom = 14;
    else zoom = 15;

    // Create path string for the route - simplify to avoid URL length limits
    const simplifiedCoords = coordinates.filter((_, index) => index % Math.max(1, Math.floor(coordinates.length / 100)) === 0);
    const pathString = simplifiedCoords.map((coord: number[]) => `${coord[0]},${coord[1]}`).join(',');
    const encodedPath = encodeURIComponent(`path-5+ff0000-0.8(${pathString})`);

    // Add photo markers
    let markers = '';
    if (photos.length > 0) {
      const photoMarkers = photos
        .filter(photo => photo.latitude && photo.longitude)
        .slice(0, 10) // Limit markers for URL length
        .map(photo => `pin-s-camera+0080ff(${photo.longitude},${photo.latitude})`)
        .join(',');
      if (photoMarkers) {
        markers = ',' + photoMarkers;
      }
    }

    const url = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${encodedPath}${markers}/${centerLng},${centerLat},${zoom}/400x300@2x?access_token=${accessToken}`;
    console.log('Generated static map URL (simplified coords):', url.substring(0, 100) + '...');
    console.log('Route stats:', {
      originalCoords: coordinates.length,
      simplifiedCoords: simplifiedCoords.length,
      bounds,
      zoom,
      center: [centerLng, centerLat]
    });
    return url;
  };

  const staticMapUrl = getStaticMapUrl();

  if (showFullMap) {
    return <FullScreenMapModal 
      gpxData={gpxData} 
      photos={photos} 
      onPhotoClick={onPhotoClick} 
      onClose={() => setShowFullMap(false)} 
    />;
  }

  return (
    <div className={`relative ${className}`}>
      {/* Preview Image */}
      <div className="relative w-full h-64 sm:h-96 bg-gray-200 rounded overflow-hidden">
        {staticMapUrl ? (
          <img
            src={staticMapUrl}
            alt="Map preview"
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              console.error('Failed to load static map:', staticMapUrl);
              console.error('Error:', e);
              // Hide the broken image and show fallback
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
        ) : hasValidTrack ? (
          // Fallback for when static map fails to load
          <div className="w-full h-full bg-gradient-to-br from-green-100 to-blue-100 flex items-center justify-center">
            <div className="text-center p-6">
              <View size={48} className="mx-auto mb-4 text-gray-600" />
              <p className="text-gray-600 text-sm">Map preview unavailable</p>
            </div>
          </div>
        ) : (
          // No valid track data
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <div className="text-center p-6">
              <View size={48} className="mx-auto mb-4 text-gray-400" />
              <p className="text-gray-500 text-sm">No route data available</p>
            </div>
          </div>
        )}



        {/* View Details Button */}
        <div className="absolute bottom-4 right-4">
          <Button
            kind="primary"
            size="sm"
            renderIcon={Maximize}
            onClick={() => setShowFullMap(true)}
            className="flex items-center gap-2"
            data-testid="button-view-map-details"
          >
            <span>View Details</span>
          </Button>
        </div>
      </div>
    </div>
  );
}