import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { createPhotoMarkerElement } from "@/lib/photo-marker";
import { initMapbox } from "@/lib/mapbox";
import { MapTerrainControls, TERRAIN_PITCH, applyTerrain } from "@/components/map-terrain-controls";
import { parseGpxData } from "@shared/gpx-utils";
import { MAP_STYLES, applyMapStyleExtras, getMapStyle, loadSavedMapStyleId, saveMapStyleId } from "@/lib/map-styles";
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

/** A follow-cam view set in calibrate mode, relative to the direction of travel. */
export interface CameraAngle {
  pitch: number;
  zoom: number;
  /** Degrees the camera turns from facing the way the ride goes. */
  bearingOffset: number;
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
  /** While set, the map fits this clip's segment and hides the others; when cleared it zooms back out. */
  previewSegmentId?: string | null;
  onClipSegmentClick?: (clipId: string) => void;
  /** Zooms in on the playhead and starts following it whenever `nonce` changes. */
  focusSegment?: { id: string; nonce: number } | null;
  /** Where the video is on the route right now, as [longitude, latitude]. */
  getPlayheadPosition?: () => [number, number] | null;
  /** Direction of travel at the playhead, in degrees from north; the chase-cam faces it. */
  getPlayheadBearing?: () => number | null;
  /** While true, the playhead pin is updated every frame and the map follows it. */
  isPlaying?: boolean;
  /** Dragging the playhead pin: called on grab, on every move, and on release. */
  onPlayheadDragStart?: () => void;
  onPlayheadDrag?: (position: [number, number]) => void;
  onPlayheadDragEnd?: (position: [number, number]) => void;
  /** Shows the 3D terrain switch in the map's corner. */
  showTerrainControls?: boolean;
  /** Start detail maps in true-scale 3D terrain; other maps remain 2D by default. */
  initial3D?: boolean;
  /** The 3D follow-cam's pitch, zoom and turn from the direction of travel; unset uses the default chase-cam. */
  cameraAngle?: CameraAngle | null;
  /** While set, the map goes to the 3D follow view and reports the angle each time the user moves the camera. */
  onCameraAngleChange?: (angle: CameraAngle) => void;
  /** A note shown across the top of the map, e.g. calibrate mode's instructions. */
  banner?: string | null;
  /** Space covered by cards floating over the map; the camera centers in what's left. */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** The zoom and compass buttons; off where floating cards would cover them. */
  showNavigationControl?: boolean;
  /** Where the 3D and map layer widgets sit; defaults to the top-left corner. */
  widgetsClassName?: string;
  className?: string;
}

// How close the follow-cam sits, and how long the zoom-in on play takes.
const FOLLOW_ZOOM = 16;
const FOCUS_DURATION_MS = 1000;
// The 3D chase-cam when a clip plays: close in, tilted low behind the pin.
const CHASE_ZOOM = 16.5;
const CHASE_PITCH = 65;
const CHASE_DURATION_MS = 1400;

export default function MapboxMap({ 
  gpxData, 
  hoveredElevationPoint, 
  clipMarkers,
  photoMarkers,
  onPhotoMarkerClick,
  clipSegments,
  selectedSegmentId,
  previewSegmentId,
  onClipSegmentClick,
  focusSegment,
  getPlayheadPosition,
  getPlayheadBearing,
  isPlaying,
  onPlayheadDragStart,
  onPlayheadDrag,
  onPlayheadDragEnd,
  showTerrainControls,
  initial3D = false,
  cameraAngle,
  onCameraAngleChange,
  banner,
  padding,
  showNavigationControl = true,
  widgetsClassName = "top-3 left-3 flex-col items-start",
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
  // The map instance whose style has finished loading. A new gpxData rebuilds
  // the map, and effects running in that same commit must not touch the new,
  // still-loading instance (mapbox throws "Style is not done loading").
  const loadedMapRef = useRef<mapboxgl.Map | null>(null);
  const loadedMap = () => (map.current && map.current === loadedMapRef.current ? map.current : null);
  const playheadMarker = useRef<mapboxgl.Marker | null>(null);
  const onClipSegmentClickRef = useRef(onClipSegmentClick);
  useEffect(() => { onClipSegmentClickRef.current = onClipSegmentClick; }, [onClipSegmentClick]);
  const getPlayheadPositionRef = useRef(getPlayheadPosition);
  getPlayheadPositionRef.current = getPlayheadPosition;
  const getPlayheadBearingRef = useRef(getPlayheadBearing);
  getPlayheadBearingRef.current = getPlayheadBearing;
  const playheadDragRef = useRef({ start: onPlayheadDragStart, move: onPlayheadDrag, end: onPlayheadDragEnd });
  playheadDragRef.current = { start: onPlayheadDragStart, move: onPlayheadDrag, end: onPlayheadDragEnd };
  const draggingPlayhead = useRef(false);
  // Follow-cam: keep the map centered on the pin until the user pans away.
  // Zooming or tilting keeps it tracking; turning the map stops the camera
  // from swinging to face the direction of travel until the next play.
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  followingRef.current = following;
  // While the zoom-in animation runs, the follow-cam leaves the camera alone.
  const focusAnimatingUntil = useRef(0);
  const [is3D, setIs3D] = useState(initial3D);
  const is3DRef = useRef(initial3D);
  is3DRef.current = is3D;
  const autoBearingRef = useRef(true);
  // True while the user's hand is on the camera (zooming, tilting, turning).
  const userGestureRef = useRef(false);
  // True from the user's first camera gesture until the camera settles.
  const userMovedRef = useRef(false);
  const cameraAngleRef = useRef(cameraAngle);
  cameraAngleRef.current = cameraAngle;
  const onCameraAngleChangeRef = useRef(onCameraAngleChange);
  onCameraAngleChangeRef.current = onCameraAngleChange;
  // Which way the 3D follow-cam faces: the direction of travel, turned by the
  // calibrated offset.
  const followBearing = () => {
    const travel = getPlayheadBearingRef.current?.();
    return travel == null ? null : travel + (cameraAngleRef.current?.bearingOffset ?? 0);
  };
  // The follow-cam's view: in 3D, the calibrated angle, or close behind the
  // pin facing the way the ride goes; in 2D, zoomed in and north-up.
  const followCamera = () => {
    if (!is3DRef.current) return { zoom: FOLLOW_ZOOM, pitch: 0, bearing: 0 };
    const angle = cameraAngleRef.current;
    const bearing = followBearing();
    return {
      zoom: angle?.zoom ?? CHASE_ZOOM,
      pitch: angle?.pitch ?? CHASE_PITCH,
      ...(bearing != null ? { bearing } : {}),
    };
  };
  // True while a hovered clip is being previewed; the follow-cam stands aside.
  const previewingRef = useRef(false);
  // The base layer from the "Map layer" dropdown, remembered per browser.
  const [mapStyleId, setMapStyleId] = useState(loadSavedMapStyleId);
  const mapStyleIdRef = useRef(mapStyleId);
  // The focus request already acted on, so a style change doesn't replay it.
  const handledFocusRef = useRef<{ map: mapboxgl.Map; nonce: number } | null>(null);
  // The clip-segment hover/click listeners on the current map, so a style
  // change that re-adds the layers doesn't register them twice.
  const segmentListenersRef = useRef<{ map: mapboxgl.Map; off: () => void } | null>(null);

  // The route line. A style change wipes it, so it is re-added after one.
  const addTrackLayer = (m: mapboxgl.Map) => {
    if (coordinatesRef.current.length === 0 || m.getSource('gpx-track')) return;
    m.addSource('gpx-track', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coordinatesRef.current },
        }],
      },
    });
    m.addLayer({
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
  };

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
    coordinatesRef.current = parsedGpxData?.coordinates ?? [];

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
        style: getMapStyle(mapStyleIdRef.current).url,
        center: initialCenter,
        zoom: initialZoom,
        pitch: initial3D ? TERRAIN_PITCH : 0,
      });
    } catch (error) {
      console.warn('Failed to create Mapbox map:', error);
      setWebglError(true);
      return;
    }

    if (showNavigationControl) map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    // Every style load, the first one included, gets its config and snow.
    const styledMap = map.current;
    // The Studio viewer changes its bounded map row as mobile browser chrome
    // expands/collapses. Mapbox otherwise only listens for window resizes.
    const resizeObserver = new ResizeObserver(() => styledMap.resize());
    resizeObserver.observe(mapContainer.current);
    styledMap.on('style.load', () => applyMapStyleExtras(styledMap, getMapStyle(mapStyleIdRef.current)));

    map.current.on('load', () => {
      if (!map.current) return;

      // Add GPX track if available
      if (parsedGpxData && parsedGpxData.coordinates && parsedGpxData.coordinates.length > 0) {
        addTrackLayer(map.current);

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
            duration: 0, // No animation
            pitch: is3DRef.current ? TERRAIN_PITCH : 0,
          });
        }
      }
      // Only the user's own gestures carry an originalEvent; our jumpTo and
      // easeTo calls don't. Panning hands the camera to the user; zooming and
      // tilting keep tracking the pin, and turning the map keeps their heading.
      const m = map.current;
      m.on('dragstart', (e: any) => {
        if (!e.originalEvent) return;
        userMovedRef.current = true;
        // Calibrating the angle moves the camera around the pin, not off it.
        if (!onCameraAngleChangeRef.current) setFollowing(false);
      });
      m.on('rotatestart', (e: any) => {
        if (e.originalEvent) autoBearingRef.current = false;
      });
      (['zoomstart', 'pitchstart', 'rotatestart'] as const).forEach((type) =>
        m.on(type, (e: any) => {
          if (!e.originalEvent) return;
          userGestureRef.current = true;
          userMovedRef.current = true;
        }),
      );
      // The follow-cam waits for the gesture to finish, so it doesn't cut it off.
      m.on('moveend', () => {
        userGestureRef.current = false;
        if (!userMovedRef.current) return;
        userMovedRef.current = false;
        const report = onCameraAngleChangeRef.current;
        if (!report) return;
        const travel = getPlayheadBearingRef.current?.() ?? 0;
        report({
          pitch: m.getPitch(),
          zoom: m.getZoom(),
          bearingOffset: ((m.getBearing() - travel + 540) % 360) - 180,
        });
      });
      loadedMapRef.current = map.current;
      setMapReady(true);
    });

    return () => {
      resizeObserver.disconnect();
      loadedMapRef.current = null;
      segmentListenersRef.current = null;
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

      // Ignore the missing-location sentinel rather than jumping to the Gulf of Guinea.
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

  // Clip segments: a thicker colored line per clip over the route. Hovering
  // shows which clip it is; clicking loads that clip.
  useEffect(() => {
    const m = loadedMap();
    if (!m) return;

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
            selected: segment.id === selectedSegmentId || segment.id === previewSegmentId,
            preview: segment.id === previewSegmentId,
          },
          geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
        })),
    };

    // A previewed clip is drawn alone.
    const filter = previewSegmentId ? ['==', ['get', 'id'], previewSegmentId] : null;
    const source = m.getSource('clip-segments') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      m.setFilter('clip-segments-casing', filter as any);
      m.setFilter('clip-segments-line', filter as any);
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
        'line-width': ['case', ['get', 'preview'], 15, ['get', 'selected'], 11, 8],
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
        'line-width': ['case', ['get', 'preview'], 10, ['get', 'selected'], 8, 5],
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
    if (filter) {
      m.setFilter('clip-segments-casing', filter as any);
      m.setFilter('clip-segments-line', filter as any);
    }
    if (segmentListenersRef.current?.map === m) segmentListenersRef.current.off();
    m.on('mousemove', 'clip-segments-line', onMove);
    m.on('mouseleave', 'clip-segments-line', onLeave);
    m.on('click', 'clip-segments-line', onClick);
    segmentListenersRef.current = {
      map: m,
      off: () => {
        popup.remove();
        m.off('mousemove', 'clip-segments-line', onMove);
        m.off('mouseleave', 'clip-segments-line', onLeave);
        m.off('click', 'clip-segments-line', onClick);
      },
    };
    // Listeners and layers go away with the map itself (see the init effect).
  }, [mapReady, clipSegments, selectedSegmentId, previewSegmentId]);

  // Hovering a clip fits its whole stretch in view; letting go returns to the
  // full route, or to the pin if a clip is playing and being followed.
  useEffect(() => {
    const m = loadedMap();
    if (!m) return;
    if (previewSegmentId) {
      const segment = clipSegments?.find((s) => s.id === previewSegmentId);
      if (!segment || segment.coordinates.length === 0) return;
      previewingRef.current = true;
      const bounds = new mapboxgl.LngLatBounds();
      segment.coordinates.forEach((coord) => bounds.extend(coord));
      m.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 600, pitch: is3DRef.current ? TERRAIN_PITCH : 0 });
      return;
    }
    if (!previewingRef.current) return;
    previewingRef.current = false;
    const pin = getPlayheadPositionRef.current?.();
    if (isPlaying && followingRef.current && pin) {
      focusAnimatingUntil.current = performance.now() + FOCUS_DURATION_MS;
      m.easeTo({ center: pin, ...followCamera(), duration: FOCUS_DURATION_MS });
      return;
    }
    const route = new mapboxgl.LngLatBounds();
    coordinatesRef.current.forEach((coord) => route.extend(coord));
    if (!route.isEmpty()) m.fitBounds(route, { padding: 50, duration: 600, pitch: is3DRef.current ? TERRAIN_PITCH : 0 });
    // Only a change of hovered clip should move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, previewSegmentId]);

  // Keep the camera centred in the part of the map that floating cards leave free.
  const paddingKey = padding ? [padding.top, padding.right, padding.bottom, padding.left].join(",") : "";
  useEffect(() => {
    const m = loadedMap();
    if (!m || !padding) return;
    m.setPadding(padding);
    // Only a change in the covered space should move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, paddingKey]);

  // Zoom in on the pin and start following it when asked (when a clip starts playing).
  useEffect(() => {
    const m = loadedMap();
    if (!m || !focusSegment) return;
    // A style change re-runs this; only a new request should move the map.
    if (handledFocusRef.current?.map === m && handledFocusRef.current.nonce === focusSegment.nonce) return;
    handledFocusRef.current = { map: m, nonce: focusSegment.nonce };
    const segment = clipSegments?.find((s) => s.id === focusSegment.id);
    const center = getPlayheadPositionRef.current?.() ?? segment?.coordinates[0];
    if (!center) return;
    setFollowing(true);
    autoBearingRef.current = true;
    // Playing always goes to the 3D chase view where the map offers 3D.
    if (showTerrainControls) {
      is3DRef.current = true;
      setIs3D(true);
    }
    focusAnimatingUntil.current = performance.now() + CHASE_DURATION_MS;
    m.easeTo({ center, ...followCamera(), duration: CHASE_DURATION_MS });
    // Only a new request should move the map, not every segment refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, focusSegment?.nonce]);

  // Snap back to the follow-cam's zoomed-in view of the pin.
  const resumeFollowing = () => {
    const m = map.current;
    const center = getPlayheadPositionRef.current?.();
    setFollowing(true);
    autoBearingRef.current = true;
    if (!m || !center) return;
    focusAnimatingUntil.current = performance.now() + FOCUS_DURATION_MS;
    m.easeTo({ center, ...followCamera(), duration: FOCUS_DURATION_MS });
  };

  // Swap the base layer. setStyle drops our own sources and layers, so the
  // map counts as not ready until the new style loads and the track is back;
  // the effects keyed on mapReady then re-add segments and terrain. DOM
  // markers (pins, photos, clip ends) aren't part of the style and stay put.
  const changeMapStyle = (id: string) => {
    const style = getMapStyle(id);
    if (style.id === mapStyleIdRef.current) return;
    mapStyleIdRef.current = style.id;
    setMapStyleId(style.id);
    saveMapStyleId(style.id);
    const m = loadedMap();
    if (!m) return; // Still loading: the first style.load picks up the new choice.
    loadedMapRef.current = null;
    setMapReady(false);
    const camera = { center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    m.once('style.load', () => {
      if (map.current !== m) return;
      m.jumpTo(camera);
      addTrackLayer(m);
      loadedMapRef.current = m;
      setMapReady(true);
    });
    // diff: false forces a full reload, so style.load always fires.
    m.setStyle(style.url, { diff: false } as any);
  };

  // Calibrating the angle starts from the 3D follow view of the pin, so the
  // user adjusts what will actually play.
  const calibratingAngle = !!onCameraAngleChange;
  useEffect(() => {
    const m = loadedMap();
    if (!m || !calibratingAngle) return;
    if (showTerrainControls) {
      is3DRef.current = true;
      setIs3D(true);
    }
    setFollowing(true);
    autoBearingRef.current = true;
    const center = getPlayheadPositionRef.current?.();
    focusAnimatingUntil.current = performance.now() + FOCUS_DURATION_MS;
    m.easeTo({ ...(center ? { center } : {}), ...followCamera(), duration: FOCUS_DURATION_MS });
    // Only entering calibrate mode should move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, calibratingAngle]);

  // Terrain also applies to detail maps that intentionally hide the 3D switch.
  useEffect(() => {
    const m = loadedMap();
    if (!m) return;
    applyTerrain(m, { is3D });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, showTerrainControls, is3D]);

  const toggle3D = () => {
    const next = !is3D;
    setIs3D(next);
    const m = loadedMap();
    if (!m) return;
    focusAnimatingUntil.current = performance.now() + FOCUS_DURATION_MS;
    m.easeTo(next ? { pitch: TERRAIN_PITCH, duration: FOCUS_DURATION_MS } : { pitch: 0, bearing: 0, duration: FOCUS_DURATION_MS });
  };

  // Playhead pin: where the video is on the route. Updated every frame while
  // playing, with the map centered on it. Dragging the pin scrubs the video.
  useEffect(() => {
    const m = loadedMap();
    if (!m) return;

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
      if (
        follow &&
        followingRef.current &&
        !previewingRef.current &&
        !userGestureRef.current &&
        performance.now() > focusAnimatingUntil.current
      ) {
        const target = is3DRef.current && autoBearingRef.current ? followBearing() : null;
        if (target == null) {
          m.jumpTo({ center: position });
        } else {
          // Ease the heading round a little each frame, the short way, so
          // switchbacks turn the camera smoothly instead of snapping it.
          const current = m.getBearing();
          const diff = ((target - current + 540) % 360) - 180;
          m.jumpTo({ center: position, bearing: current + diff * 0.06 });
        }
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

        const markerRoot = createPhotoMarkerElement(pm, () => onPhotoMarkerClickRef.current?.(pm.id));

        const marker = new mapboxgl.Marker({ element: markerRoot, anchor: 'center' })
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

  // Overlays that sit centred on the map centre in the space the cards leave.
  const freeCenter = padding
    ? {
        left: `calc(${padding.left}px + (100% - ${padding.left + padding.right}px) / 2)`,
        maxWidth: `calc(100% - ${padding.left + padding.right + 24}px)`,
      }
    : undefined;

  return (
    <div className={`relative ${className}`}>
      {/* Inline position: mapbox's own .mapboxgl-map class sets position: relative. */}
      <div ref={mapContainer} className="bg-gray-100" style={{ position: 'absolute', inset: 0 }} data-testid="mapbox-map" />
      {banner && (
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 z-10 max-w-[60%] text-center meta-mono bg-foreground text-background rounded px-3 py-1.5 shadow-lg pointer-events-none"
          style={freeCenter}
          data-testid="map-banner"
        >
          {banner}
        </div>
      )}
      {!following && getPlayheadPosition?.() && (
        <button
          type="button"
          onClick={resumeFollowing}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 meta-mono bg-background/95 text-foreground border border-border rounded px-3 py-1.5 shadow hover:bg-background"
          style={padding ? { ...freeCenter, bottom: padding.bottom + 72 } : undefined}
          data-testid="button-recenter-pin"
        >
          ⌖ Recenter on pin
        </button>
      )}
      <div data-map-widgets className={`absolute z-10 flex gap-2 ${widgetsClassName}`} style={padding ? freeCenter : undefined}>
        {showTerrainControls && (
          <MapTerrainControls
            is3D={is3D}
            onToggle3D={toggle3D}
          />
        )}
        <label className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 text-sm text-foreground">
          <span className="font-medium">Map layer</span>
          <select
            value={mapStyleId}
            onChange={(e) => changeMapStyle(e.target.value)}
            className="bg-background border border-border rounded px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="select-map-style"
          >
            {MAP_STYLES.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}