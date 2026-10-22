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

export interface ClipSegment {
  id: string;
  title: string;
  /** Shown under the title in the hover popup, e.g. the clip's time range. */
  subtitle?: string;
  color: string;
  coordinates: [number, number][];
}

export interface PhotoMarker {
  id: string;
  latitude: number;
  longitude: number;
  thumbnailUrl: string;
}

interface MapboxMapProps {
  gpxData: any;
  hoveredElevationPoint?: ElevationPoint | null;
  clipMarkers?: ClipMarker[];
  photoMarkers?: PhotoMarker[];
  onPhotoMarkerClick?: (photoId: string) => void;
  /** Route stretches covered by video clips, drawn over the track. */
  clipSegments?: ClipSegment[];
  selectedSegmentId?: string | null;
  onClipSegmentClick?: (clipId: string) => void;
  /** Zooms in on the playhead and starts following it whenever `nonce` changes. */
  focusSegment?: { id: string; nonce: number } | null;
  /** Where the video is on the route right now, as [longitude, latitude]. */
  getPlayheadPosition?: () => [number, number] | null;
  /** While true, the playhead pin is updated every frame and the map follows it. */
  isPlaying?: boolean;
  /** Dragging the playhead pin: called on grab, on every move, and on release. */
  onPlayheadDragStart?: () => void;
  onPlayheadDrag?: (position: [number, number]) => void;
  onPlayheadDragEnd?: (position: [number, number]) => void;
  className?: string;
}

// How close the follow-cam sits, and how long the zoom-in on play takes.
const FOLLOW_ZOOM = 16;
const FOCUS_DURATION_MS = 1000;

export default function MapboxMap({ 
  gpxData, 
  hoveredElevationPoint, 
  clipMarkers,
  photoMarkers,
  onPhotoMarkerClick,
  clipSegments,
  selectedSegmentId,
  onClipSegmentClick,
  focusSegment,
  getPlayheadPosition,
  isPlaying,
  onPlayheadDragStart,
  onPlayheadDrag,
  onPlayheadDragEnd,
  className 
}: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const elevationMarker = useRef<mapboxgl.Marker | null>(null);
  const clipMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const photoMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const onPhotoMarkerClickRef = useRef(onPhotoMarkerClick);
  useEffect(() => { onPhotoMarkerClickRef.current = onPhotoMarkerClick; }, [onPhotoMarkerClick]);
  const animationFrameRef = useRef<number | null>(null);
  const coordinatesRef = useRef<[number, number][]>([]);
  const [webglError, setWebglError] = useState(false);
  // Set once the style has loaded, so layers added after the track can rely on it.
  const [mapReady, setMapReady] = useState(false);
  const playheadMarker = useRef<mapboxgl.Marker | null>(null);
  const onClipSegmentClickRef = useRef(onClipSegmentClick);
  useEffect(() => { onClipSegmentClickRef.current = onClipSegmentClick; }, [onClipSegmentClick]);
  const getPlayheadPositionRef = useRef(getPlayheadPosition);
  getPlayheadPositionRef.current = getPlayheadPosition;
  const playheadDragRef = useRef({ start: onPlayheadDragStart, move: onPlayheadDrag, end: onPlayheadDragEnd });
  playheadDragRef.current = { start: onPlayheadDragStart, move: onPlayheadDrag, end: onPlayheadDragEnd };
  const draggingPlayhead = useRef(false);
  // Follow-cam: keep the map centered on the pin until the user pans away.
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  followingRef.current = following;
  // While the zoom-in animation runs, the follow-cam leaves the camera alone.
  const focusAnimatingUntil = useRef(0);

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
      // Only a user's pan carries an originalEvent; ours (jumpTo/easeTo) don't.
      map.current.on('dragstart', (e: any) => {
        if (e.originalEvent) setFollowing(false);
      });
      setMapReady(true);
    });

    return () => {
      setMapReady(false);
      playheadMarker.current?.remove();
      playheadMarker.current = null;
      // Clean up animation frames
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      if (elevationMarker.current) {
        elevationMarker.current.remove();
        elevationMarker.current = null;
      }
      // Clear marker refs so they get re-added when a new map is created
      clipMarkersRef.current.forEach((m) => m.remove());
      clipMarkersRef.current.clear();
      photoMarkersRef.current.forEach((m) => m.remove());
      photoMarkersRef.current.clear();
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

  // Clip segments: a thicker colored line per clip over the route. Hovering
  // shows which clip it is; clicking loads that clip.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;

    const data = {
      type: 'FeatureCollection' as const,
      features: (clipSegments ?? [])
        .filter((segment) => segment.coordinates.length >= 2)
        .map((segment) => ({
          type: 'Feature' as const,
          properties: {
            id: segment.id,
            title: segment.title,
            subtitle: segment.subtitle ?? '',
            color: segment.color,
            selected: segment.id === selectedSegmentId,
          },
          geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
        })),
    };

    const source = m.getSource('clip-segments') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }

    m.addSource('clip-segments', { type: 'geojson', data });
    m.addLayer({
      id: 'clip-segments-casing',
      type: 'line',
      source: 'clip-segments',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['case', ['get', 'selected'], 11, 8],
        'line-opacity': 0.9,
      },
    });
    m.addLayer({
      id: 'clip-segments-line',
      type: 'line',
      source: 'clip-segments',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['get', 'selected'], 8, 5],
      },
    });

    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    const onMove = (e: mapboxgl.MapLayerMouseEvent) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      m.getCanvas().style.cursor = 'pointer';
      const content = document.createElement('div');
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;font-size:12px;';
      title.textContent = String(props.title);
      content.appendChild(title);
      if (props.subtitle) {
        const subtitle = document.createElement('div');
        subtitle.style.cssText = 'font-size:11px;opacity:0.7;margin-top:2px;';
        subtitle.textContent = `${props.subtitle} · click to play`;
        content.appendChild(subtitle);
      }
      popup.setLngLat(e.lngLat).setDOMContent(content).addTo(m);
    };
    const onLeave = () => {
      m.getCanvas().style.cursor = '';
      popup.remove();
    };
    const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) onClipSegmentClickRef.current?.(String(id));
    };
    m.on('mousemove', 'clip-segments-line', onMove);
    m.on('mouseleave', 'clip-segments-line', onLeave);
    m.on('click', 'clip-segments-line', onClick);
    // Listeners and layers go away with the map itself (see the init effect).
  }, [mapReady, clipSegments, selectedSegmentId]);

  // Zoom in on the pin and start following it when asked (when a clip starts playing).
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady || !focusSegment) return;
    const segment = clipSegments?.find((s) => s.id === focusSegment.id);
    const center = getPlayheadPositionRef.current?.() ?? segment?.coordinates[0];
    if (!center) return;
    setFollowing(true);
    focusAnimatingUntil.current = performance.now() + FOCUS_DURATION_MS;
    m.easeTo({ center, zoom: Math.max(m.getZoom(), FOLLOW_ZOOM), duration: FOCUS_DURATION_MS });
    // Only a new request should move the map, not every segment refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, focusSegment?.nonce]);

  const resumeFollowing = () => {
    const m = map.current;
    const center = getPlayheadPositionRef.current?.();
    setFollowing(true);
    if (!m || !center) return;
    focusAnimatingUntil.current = performance.now() + FOCUS_DURATION_MS;
    m.easeTo({ center, zoom: Math.max(m.getZoom(), FOLLOW_ZOOM), duration: FOCUS_DURATION_MS });
  };

  // Playhead pin: where the video is on the route. Updated every frame while
  // playing, with the map centered on it. Dragging the pin scrubs the video.
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;

    const place = (follow: boolean) => {
      // The user's hand is on the pin; let it go where they put it.
      if (draggingPlayhead.current) return;
      const position = getPlayheadPositionRef.current?.() ?? null;
      if (!position) {
        playheadMarker.current?.remove();
        playheadMarker.current = null;
        return;
      }
      if (!playheadMarker.current) {
        const el = document.createElement('div');
        el.style.cssText = `
          width: 18px; height: 18px; border-radius: 50%;
          background: #ef4444; border: 3px solid #ffffff;
          box-shadow: 0 2px 10px rgba(14, 13, 11, 0.5);
          cursor: grab;
        `;
        el.setAttribute('data-testid', 'map-playhead');
        el.title = 'Drag to scrub the video';
        const marker = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat(position).addTo(m);
        const lngLat = (): [number, number] => {
          const { lng, lat } = marker.getLngLat();
          return [lng, lat];
        };
        marker.on('dragstart', () => {
          draggingPlayhead.current = true;
          el.style.cursor = 'grabbing';
          playheadDragRef.current.start?.();
        });
        marker.on('drag', () => playheadDragRef.current.move?.(lngLat()));
        marker.on('dragend', () => {
          draggingPlayhead.current = false;
          el.style.cursor = 'grab';
          playheadDragRef.current.end?.(lngLat());
          // Snap back onto the route at the time the video landed on.
          const snapped = getPlayheadPositionRef.current?.();
          if (snapped) marker.setLngLat(snapped);
        });
        playheadMarker.current = marker;
      } else {
        playheadMarker.current.setLngLat(position);
      }
      if (follow && followingRef.current && performance.now() > focusAnimatingUntil.current) {
        m.jumpTo({ center: position });
      }
    };

    place(false);
    if (!isPlaying) return;
    let frame = requestAnimationFrame(function tick() {
      place(true);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  });

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

  // Handle photo markers (thumbnail dots at photo GPS locations)
  useEffect(() => {
    if (!map.current) return;

    const apply = () => {
      if (!map.current) return;

      const wantedIds = new Set((photoMarkers ?? []).map(p => p.id));

      // Remove markers that are no longer present
      photoMarkersRef.current.forEach((marker, id) => {
        if (!wantedIds.has(id)) {
          marker.remove();
          photoMarkersRef.current.delete(id);
        }
      });

      // Add or update markers
      (photoMarkers ?? []).forEach((pm) => {
        const existing = photoMarkersRef.current.get(pm.id);
        if (existing) {
          existing.setLngLat([pm.longitude, pm.latitude]);
          return;
        }

        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute('aria-label', 'View photo');
        el.dataset.testid = `map-photo-marker-${pm.id}`;
        el.style.cssText = `
          width: 36px;
          height: 36px;
          padding: 0;
          background: #e8e4de;
          border: 2px solid #fff;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.15);
          cursor: pointer;
          transition: transform 120ms ease;
          touch-action: manipulation;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        `;

        const img = document.createElement('img');
        // Ensure absolute URL — relative paths can misbehave in Mapbox marker DOM elements
        img.src = pm.thumbnailUrl.startsWith('http') || pm.thumbnailUrl.startsWith('//')
          ? pm.thumbnailUrl
          : `${window.location.origin}${pm.thumbnailUrl.startsWith('/') ? '' : '/'}${pm.thumbnailUrl}`;
        img.alt = '';
        img.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          border-radius: 50%;
        `;
        img.onerror = () => { img.style.display = 'none'; };
        el.appendChild(img);

        el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.12)'; });
        el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onPhotoMarkerClickRef.current?.(pm.id);
        });

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([pm.longitude, pm.latitude])
          .addTo(map.current!);

        photoMarkersRef.current.set(pm.id, marker);
      });
    };

    if (!map.current.loaded()) {
      const onLoad = () => apply();
      map.current.on('load', onLoad);
      return () => { map.current?.off('load', onLoad); };
    }

    apply();
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
    <div className={`relative ${className}`}>
      {/* Inline position: mapbox's own .mapboxgl-map class sets position: relative. */}
      <div ref={mapContainer} className="bg-gray-100" style={{ position: 'absolute', inset: 0 }} data-testid="mapbox-map" />
      {!following && isPlaying && (
        <button
          type="button"
          onClick={resumeFollowing}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 meta-mono bg-background/95 text-foreground border border-border rounded px-3 py-1.5 shadow hover:bg-background"
          data-testid="button-follow-pin"
        >
          Follow pin
        </button>
      )}
    </div>
  );
}