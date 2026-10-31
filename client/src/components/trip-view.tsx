import { useEffect, useMemo, useRef, useState, Suspense, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import type { UploadResult } from "@uppy/core";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Video,
  RefreshCw,
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";
import { ChunkedVideoUploader, type UploadedClip } from "@/components/chunked-video-uploader";
import { AutoPhotoUploader } from "@/components/auto-photo-uploader";
import { ClipEditPopover } from "@/components/clip-edit-popover";
import MapboxMap, { CameraAngle, ClipMarker, ClipSegment } from "@/components/mapbox-map";
import { compactTimedTrack, nearestTrackOffset, parseGpxData, trackBearingAt, trackPositionAt, trackSegmentBetween, type CompactTimedTrack, type ElevationPoint } from "@shared/gpx-utils";
import { MAX_TRIP_PHOTOS } from "@shared/photo-limit";
import type { FieldNote, Photo, TripPlayback, VideoClip, InsertVideoClip } from "@shared/schema";
import { type PhotoExifData } from "@/lib/exif-extractor";
import { ApiError, apiRequest } from "@/lib/queryClient";

export type StudioClip = VideoClip & { processingActive?: boolean };

// A clip still marked pending or processing that the server isn't working on
// lost its job (for example when the server was stopped mid-transcode).
function isStuck(clip: StudioClip) {
  return (
    (clip.processingStatus === "pending" || clip.processingStatus === "processing") &&
    clip.processingActive === false
  );
}

// The player's view of a trip: its route with the saved playback settings
// folded into gpxData (where Studio projects kept them), and the length of
// its timed track for the timeline.
function studioTripFor(trip: FieldNote) {
  // Trips made in the web editor keep the raw GPX text; read its timed track here.
  const gpxData = (typeof trip.gpxData === "string"
    ? { ...parseGpxData(trip.gpxData), timedTrack: compactTimedTrack(trip.gpxData) }
    : trip.gpxData ?? {}) as Record<string, unknown> & { timedTrack?: CompactTimedTrack | null };
  const playback = (trip.playback ?? {}) as TripPlayback;
  const duration =
    gpxData.timedTrack?.durationSeconds ??
    (trip.startTime && trip.endTime
      ? (new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime()) / 1000
      : null);
  return {
    id: trip.id,
    title: trip.title,
    startTime: trip.startTime,
    duration,
    gpxData: { ...gpxData, ...playback },
  };
}

// How far either side of the current spot a calibration drag may move the pin.
const CALIBRATE_RANGE_SECONDS = 300;

// Width of the left column of cards on wide screens, and its gap from the edges.
const CARD_WIDTH = 340;
const CARD_MARGIN = 12;
// The column grows to this (at most half the page) while a clip is open.
const PLAYER_CARD_WIDTH = 720;

export type MediaTab = "videos" | "photos";

interface TripViewProps {
  trip: FieldNote;
  photos: Photo[];
  /** Opens a photo full size. */
  onOpenPhoto: (photoId: string) => void;
  /** The trip card's body: details, stats, actions and the elevation chart. */
  info: ReactNode;
  /** The point under the pointer on the elevation chart, marked on the map. */
  hoveredElevationPoint?: ElevationPoint | null;
  /** Whether the viewer may add media and calibrate (the trip's owner). */
  canEdit: boolean;
  initialTab: MediaTab;
  /** Detail pages opt into the tilted terrain camera; keep other uses 2D. */
  initial3D?: boolean;
  /** The trip's clips, for viewers who can't load them (a shared link). Loaded and polled when left out. */
  clips?: StudioClip[];
  /** Where the trip card's back arrow goes; null hides it. */
  backHref?: string | null;
}

/**
 * The trip page: the route map fills the screen, with the trip's details in
 * a collapsible card on the left and its photos and videos in a card on the
 * right. Playing a clip widens the media card and the map follows the pin.
 */
export default function TripView({
  trip,
  photos,
  onOpenPhoto,
  info,
  hoveredElevationPoint,
  canEdit,
  initialTab,
  initial3D = false,
  clips: givenClips,
  backHref = "/dashboard",
}: TripViewProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  // Keyed on the id so a refetched trip doesn't hand the map a new route and rebuild it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectedProject = useMemo(() => studioTripFor(trip), [trip.id]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState<StudioClip | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Set when a clip is chosen to play; the player starts it once it mounts.
  const autoplayClipId = useRef<string | null>(null);
  const [mapFocus, setMapFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [tab, setTab] = useState<MediaTab>(initialTab);
  // On phones the trip card starts folded so the map shows.
  const [infoOpen, setInfoOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);
  // Seconds added to every clip's place on the route, to line the camera's
  // clock up with the GPS clock. Saved on the project.
  const [syncOffset, setSyncOffset] = useState(0);
  // While on, dragging the pin moves the sync instead of the video.
  const [calibrating, setCalibrating] = useState(false);
  useEffect(() => {
    if (isMobile) setCalibrating(false);
  }, [isMobile]);

  // The page's size, for the space the cards take from the map.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const saveSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The 3D follow-cam's angle, set by moving the map in calibrate mode.
  // Saved on the project; null plays with the default chase-cam.
  const [cameraAngle, setCameraAngle] = useState<CameraAngle | null>(null);
  const saveAngleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterDrag = useRef(false);
  // The clip under the pointer in the list. The map zooms to it and hides
  // the rest. Small delays keep a quick sweep across the cards from bouncing
  // the map around.
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverClip = (clipId: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredClipId(clipId), clipId ? 120 : 200);
  };
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  useEffect(() => {
    if (!isMobile) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredClipId(null);
  }, [isMobile]);

  const { data: loadedClips = [] } = useQuery<StudioClip[]>({
    queryKey: ["/api/video-clips", selectedProject?.id],
    queryFn: async () => {
      if (!selectedProject?.id) return [];
      const response = await apiRequest(`/api/video-clips?tripId=${selectedProject.id}`, "GET");
      return response.json();
    },
    enabled: !!selectedProject?.id && !givenClips,
    refetchInterval: (query) => {
      const hasProcessing = query.state.data?.some(
        (clip) => clip.processingStatus !== "ready" && clip.processingStatus !== "error",
      );
      return hasProcessing ? 3000 : false;
    },
  });
  const clips = givenClips ?? loadedClips;

  // Keep the player's clip in step with polling, so it switches from
  // processing to playable (or stuck) without reselecting it.
  useEffect(() => {
    setSelectedClip((current) => (current ? clips.find((clip) => clip.id === current.id) ?? current : current));
  }, [clips]);

  useEffect(() => {
    const saved = (selectedProject?.gpxData as { syncOffsetSeconds?: number } | undefined)?.syncOffsetSeconds;
    setSyncOffset(typeof saved === "number" ? saved : 0);
    const savedAngle = (selectedProject?.gpxData as { cameraAngle?: CameraAngle | null } | undefined)?.cameraAngle;
    setCameraAngle(savedAngle ?? null);
    setCalibrating(false);
    // Only on switching projects; later saves come from this page's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  const changeSyncOffset = (value: number) => {
    const projectId = selectedProject?.id;
    const rounded = Math.round(value * 10) / 10;
    setSyncOffset(rounded);
    if (!projectId) return;
    if (saveSyncTimer.current) clearTimeout(saveSyncTimer.current);
    saveSyncTimer.current = setTimeout(() => {
      apiRequest(`/api/field-notes/${projectId}/playback`, "PUT", { syncOffsetSeconds: rounded })
        .then(async (response) => {
          // A server still running older code answers this route with the app's
          // HTML page instead of JSON.
          if (!response.headers.get("content-type")?.includes("application/json")) {
            throw new Error("The server hasn't picked up this feature yet. Restart or republish it.");
          }
          return (await response.json()) as FieldNote;
        })
        .then(() => {
          // The offset already lives in this page's state; the trip query
          // only needs to know for the next visit.
          queryClient.invalidateQueries({ queryKey: ["/api/field-notes", projectId] });
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof ApiError
              ? `${error.status}: ${(error.data as { message?: string } | null)?.message ?? "request failed"}`
              : error instanceof Error
                ? error.message
                : "request failed";
          toast({ title: "Couldn't save the sync offset", description: reason, variant: "destructive" });
        });
    }, 600);
  };

  const changeCameraAngle = (angle: CameraAngle | null) => {
    const projectId = selectedProject?.id;
    setCameraAngle(angle);
    if (!projectId) return;
    if (saveAngleTimer.current) clearTimeout(saveAngleTimer.current);
    saveAngleTimer.current = setTimeout(() => {
      apiRequest(`/api/field-notes/${projectId}/playback`, "PUT", { cameraAngle: angle })
        .then((response) => {
          // A server still running older code answers this route with the app's HTML page.
          if (!response.headers.get("content-type")?.includes("application/json")) {
            throw new Error("The server hasn't picked up this feature yet. Restart or republish it.");
          }
          // As with the sync offset, the angle already lives in this page's state.
          queryClient.invalidateQueries({ queryKey: ["/api/field-notes", projectId] });
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof ApiError
              ? `${error.status}: ${(error.data as { message?: string } | null)?.message ?? "request failed"}`
              : error instanceof Error
                ? error.message
                : "request failed";
          toast({ title: "Couldn't save the camera angle", description: reason, variant: "destructive" });
        });
    }, 600);
  };

  const retryProcessing = (clipId: string) => {
    apiRequest(`/api/video-clips/${clipId}/reprocess`, "POST")
      .then(() => {
        toast({ title: "Reprocessing started" });
        queryClient.invalidateQueries({ queryKey: ["/api/video-clips", selectedProject?.id] });
      })
      .catch(() =>
        toast({ title: "Error", description: "Failed to reprocess video", variant: "destructive" }),
      );
  };

  // Load a clip into the player and start it. Clips that aren't ready only
  // show their status, so there is nothing to play yet.
  const playClip = (clip: StudioClip) => {
    setSelectedClip(clip);
    if (clip.processingStatus !== "ready") return;
    if (selectedClip?.id === clip.id && videoRef.current) {
      void videoRef.current.play().catch(() => {});
    } else {
      autoplayClipId.current = clip.id;
      setCurrentTime(0);
    }
  };

  const updateClipMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<InsertVideoClip> }) => {
      const response = await apiRequest(`/api/video-clips/${id}`, "PUT", updates);
      return response.json();
    },
    onSuccess: (clip: VideoClip) => {
      setSelectedClip((current) => (current?.id === clip.id ? clip : current));
      queryClient.invalidateQueries({ queryKey: ["/api/video-clips", selectedProject?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message || "Failed to update clip", variant: "destructive" }),
  });

  // Saves clips one after another, so they keep the order they were picked in,
  // with one notice for the batch.
  const handleClipsUpload = async (clips: UploadedClip[]) => {
    const fieldNoteId = selectedProject?.id;
    if (!fieldNoteId) return;
    let saved = 0;
    for (const clip of clips) {
      try {
        await apiRequest("/api/video-clips", "POST", { fieldNoteId, ...clip });
        saved++;
      } catch {
        // Counted below.
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/video-clips", fieldNoteId] });
    // The trip's video count changed, for the dashboard and its filter.
    queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
    if (saved > 0) {
      toast({
        title: saved === 1 ? "Clip added" : `${saved} clips added`,
        description: clips.length === 1 ? `"${clips[0].title}"` : "They'll play once processing finishes.",
      });
    }
    if (saved < clips.length) {
      toast({
        title: "Error",
        description: `${clips.length - saved} clip${clips.length - saved === 1 ? "" : "s"} couldn't be added.`,
        variant: "destructive",
      });
    }
  };

  // The first timed GPX point is the route's real start; older projects only
  // have the project start time, which may be the GPX export time.
  const routeStartTime =
    (selectedProject?.gpxData as { timedTrack?: { startTime?: string } } | undefined)?.timedTrack?.startTime ??
    selectedProject?.startTime ??
    null;

  const clipColors = [
    "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981",
    "#ef4444", "#f97316", "#6366f1", "#84cc16",
  ];
  // Clips created before recoloring existed were all saved with the uploader's
  // default blue, so treat that value as "no color chosen" and keep the palette.
  const LEGACY_DEFAULT_CLIP_COLOR = "#3b82f6";
  const clipColor = (clip: VideoClip, index: number) =>
    clip.color && clip.color.toLowerCase() !== LEGACY_DEFAULT_CLIP_COLOR
      ? clip.color
      : clipColors[index % clipColors.length];

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const timedTrack = (selectedProject?.gpxData as { timedTrack?: CompactTimedTrack | null } | undefined)?.timedTrack;
  const clipSegments: ClipSegment[] = useMemo(
    () =>
      clips.map((clip, index) => ({
        id: clip.id,
        title: clip.title,
        subtitle: `${formatTime(clip.startTime)} → ${formatTime(clip.endTime)}`,
        color: clipColor(clip, index),
        coordinates: trackSegmentBetween(timedTrack, clip.startTime + syncOffset, clip.endTime + syncOffset),
      })),
    // clipColor only depends on the clip and its index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clips, timedTrack, syncOffset],
  );

  // Start and end pins for the hovered clip, or else the selected one. Taken
  // from the drawn segment so they sit on its ends, sync offset included.
  const markerClip = clips.find((clip) => clip.id === hoveredClipId) ?? selectedClip;
  const clipMarkers: ClipMarker[] = (() => {
    if (!markerClip) return [];
    const index = Math.max(clips.findIndex((clip) => clip.id === markerClip.id), 0);
    const color = clipColor(markerClip, index);
    const coordinates = clipSegments.find((segment) => segment.id === markerClip.id)?.coordinates ?? [];
    const start = coordinates[0] ??
      (markerClip.startLongitude != null && markerClip.startLatitude != null
        ? [markerClip.startLongitude, markerClip.startLatitude] : null);
    const end = coordinates[coordinates.length - 1] ??
      (markerClip.endLongitude != null && markerClip.endLatitude != null
        ? [markerClip.endLongitude, markerClip.endLatitude] : null);
    const markers: ClipMarker[] = [];
    if (start) markers.push({ id: markerClip.id, type: "start", longitude: start[0], latitude: start[1], color });
    if (end) markers.push({ id: markerClip.id, type: "end", longitude: end[0], latitude: end[1], color });
    return markers;
  })();

  // Route position of the video's current frame: the clip's start on the
  // route, plus the sync offset, plus how far into the clip the player is.
  const getPlayheadPosition = (): [number, number] | null => {
    if (!selectedClip || selectedClip.processingStatus !== "ready") return null;
    const videoTime = videoRef.current?.currentTime ?? currentTime;
    return trackPositionAt(timedTrack, selectedClip.startTime + syncOffset + videoTime);
  };

  const getPlayheadBearing = (): number | null => {
    if (!selectedClip || selectedClip.processingStatus !== "ready") return null;
    const videoTime = videoRef.current?.currentTime ?? currentTime;
    return trackBearingAt(timedTrack, selectedClip.startTime + syncOffset + videoTime);
  };

  // Dragging the pin. Normally it scrubs: the video jumps to the moment the
  // pin's spot on the route was ridden. In calibrate mode the video holds
  // still and the drag sets the sync offset instead.
  const handlePlayheadDragStart = () => {
    const video = videoRef.current;
    resumeAfterDrag.current = !!video && !video.paused && !calibrating;
    video?.pause();
  };

  const handlePlayheadDrag = (position: [number, number], done = false) => {
    const video = videoRef.current;
    if (!video || !selectedClip) return;
    const clipStart = selectedClip.startTime + syncOffset;
    if (calibrating) {
      const here = clipStart + video.currentTime;
      const t = nearestTrackOffset(timedTrack, position, here - CALIBRATE_RANGE_SECONDS, here + CALIBRATE_RANGE_SECONDS);
      if (t !== null) {
        const offset = t - selectedClip.startTime - video.currentTime;
        if (done) changeSyncOffset(offset);
        else setSyncOffset(Math.round(offset * 10) / 10);
      }
      return;
    }
    const length = Number.isFinite(video.duration) ? video.duration : selectedClip.duration;
    const t = nearestTrackOffset(timedTrack, position, clipStart, clipStart + length);
    if (t === null) return;
    const target = t - clipStart;
    // fastSeek lands on a nearby keyframe, which keeps a fast drag responsive;
    // the release does an exact seek.
    if (!done && typeof video.fastSeek === "function") video.fastSeek(target);
    else video.currentTime = target;
    setCurrentTime(target);
  };

  const handlePlayheadDragEnd = (position: [number, number]) => {
    handlePlayheadDrag(position, true);
    if (resumeAfterDrag.current) void videoRef.current?.play().catch(() => {});
    resumeAfterDrag.current = false;
  };


  // Photos with a location get a pin on the map.
  const photoMarkers = useMemo(
    () => photos
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({
        id: p.id,
        latitude: p.latitude as number,
        longitude: p.longitude as number,
        thumbnailUrl: p.url,
      })),
    [photos],
  );

  // Photos added from the media card are saved to the trip right away.
  const [acknowledgedUploadIds, setAcknowledgedUploadIds] = useState<string[]>([]);
  const getPhotoUploadParameters = async () => {
    const response = await apiRequest("/api/photos/upload", "POST");
    const data = await response.json();
    return { method: "PUT" as const, url: data.uploadURL as string };
  };
  const handlePhotosUploaded = async (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
    exifData?: (PhotoExifData | null)[],
  ) => {
    const uploads = (result.successful ?? []) as unknown as { id: string; name?: string; uploadURL: string }[];
    setAcknowledgedUploadIds((prev) => [...prev, ...uploads.map((upload) => upload.id)]);
    let saved = 0;
    for (let index = 0; index < uploads.length; index++) {
      const upload = uploads[index];
      const exif = exifData?.[index];
      try {
        await apiRequest("/api/photos", "POST", {
          fieldNoteId: trip.id,
          filename: upload.name ?? "photo",
          url: upload.uploadURL,
          latitude: exif?.latitude,
          longitude: exif?.longitude,
          elevation: exif?.elevation,
        });
        saved += 1;
      } catch {
        // Counted below; the rest still get saved.
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/field-notes", trip.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
    if (saved > 0) toast({ title: `${saved} photo${saved === 1 ? "" : "s"} added` });
    if (saved < uploads.length) {
      toast({
        title: "Some photos weren't added",
        description: `${uploads.length - saved} couldn't be saved to the trip.`,
        variant: "destructive",
      });
    }
  };

  const openClip = (clip: StudioClip) => {
    setTab("videos");
    playClip(clip);
  };
  const closePlayer = () => {
    videoRef.current?.pause();
    setSelectedClip(null);
    setCalibrating(false);
  };

  // A clip open in the player widens the left column on wide screens.
  const playerOpen = tab === "videos" && !!selectedClip;
  const columnWidth = playerOpen
    ? Math.max(CARD_WIDTH, Math.min(PLAYER_CARD_WIDTH, viewport.width * 0.5))
    : CARD_WIDTH;
  // The map centres the route and the followed pin in the space the cards leave.
  const mapPadding = isMobile
    ? { top: 64, right: 0, bottom: Math.round(viewport.height * 0.45), left: 0 }
    : { top: 0, right: 0, bottom: 0, left: columnWidth + CARD_MARGIN * 2 };

  const tabClass = (active: boolean) =>
    `meta-mono px-2.5 py-1 rounded-full transition-colors ${
      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
    }`;
  const addButtonClass =
    "meta-mono text-foreground border border-border rounded-full px-2.5 py-1 hover:border-foreground/40 transition-colors bg-transparent cursor-pointer";
  // The photo uploader's button is a Carbon button with an icon; flatten it to match.
  const addPhotoButtonClass = `${addButtonClass} !min-h-0 !px-2.5 !py-1 !bg-transparent !text-foreground !border-border !shadow-none [&>svg]:!hidden`;

  return (
    <div
      ref={viewportRef}
      className="relative h-[calc(100vh-2.75rem)] h-[calc(100dvh-2.75rem)] overflow-hidden bg-muted"
    >
      {/* The map fills the page; everything else floats over it. */}
      <div className="absolute inset-0">
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center meta-mono text-muted-foreground">
            Loading map…
          </div>
        }
      >
        <MapboxMap
          gpxData={selectedProject.gpxData}
          hoveredElevationPoint={hoveredElevationPoint}
          photoMarkers={photoMarkers}
          onPhotoMarkerClick={onOpenPhoto}
          initial3D={initial3D}
          showTerrainControls
          showNavigationControl={false}
          widgetsClassName="w-max top-16 md:top-auto md:bottom-3 left-1/2 -translate-x-1/2 flex-row flex-wrap items-center justify-center"
          padding={mapPadding}
          cameraAngle={cameraAngle}
          onCameraAngleChange={calibrating && !isMobile ? changeCameraAngle : undefined}
          banner={calibrating ? "Pan and zoom to the angle you'd like this clip to start at" : null}
          clipMarkers={clipMarkers}
          clipSegments={clipSegments}
          selectedSegmentId={selectedClip?.id ?? null}
          previewSegmentId={hoveredClipId}
          onClipSegmentClick={(clipId) => {
            const clip = clips.find((c) => c.id === clipId);
            if (clip) openClip(clip);
          }}
          focusSegment={mapFocus}
          getPlayheadPosition={getPlayheadPosition}
          getPlayheadBearing={getPlayheadBearing}
          isPlaying={isPlaying}
          onPlayheadDragStart={handlePlayheadDragStart}
          onPlayheadDrag={handlePlayheadDrag}
          onPlayheadDragEnd={handlePlayheadDragEnd}
          className="w-full h-full"
        />
      </Suspense>
      </div>

      {/* On wide screens the trip card and the media card under it share a
          column on the left; on phones they float at the top and bottom. */}
      <div
        className="contents md:absolute md:z-20 md:top-3 md:left-3 md:bottom-3 md:flex md:flex-col md:gap-3 md:pointer-events-none md:transition-[width] md:duration-300"
        style={isMobile ? undefined : { width: columnWidth }}
      >
      {/* Trip card: back, name and details; folds down to its header. */}
      <aside
        className="absolute z-20 top-3 left-3 right-3 md:static md:w-full md:flex-shrink-0 md:pointer-events-auto flex flex-col max-h-[50%] md:max-h-[40%] rounded-lg border border-border bg-card shadow-lg"
        data-testid="trip-card"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0">
          {backHref && (
            <Link
              href={backHref}
              className="flex-shrink-0 p-1 -m-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Back to trips"
              data-testid="button-back-to-trips"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <h1 className="flex-1 min-w-0 font-serif text-lg leading-tight text-foreground truncate">{trip.title}</h1>
          <button
            type="button"
            onClick={() => setInfoOpen((open) => !open)}
            className="flex-shrink-0 p-1 -m-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label={infoOpen ? "Hide trip details" : "Show trip details"}
            aria-expanded={infoOpen}
            data-testid="button-toggle-trip-card"
          >
            {infoOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
        {infoOpen && (
          <div className="min-h-0 overflow-y-auto overscroll-contain border-t border-border px-4 pt-3 pb-4">
            {info}
          </div>
        )}
      </aside>

      {/* Media card: photos or videos, under the trip card on wide screens. */}
      <section
        className="absolute z-20 inset-x-3 bottom-3 max-h-[45%] md:static md:w-full md:min-h-0 md:max-h-none md:pointer-events-auto flex flex-col rounded-lg border border-border bg-card shadow-lg"
        data-testid="media-card"
      >
        <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0 border-b border-border">
          <button type="button" onClick={() => setTab("videos")} className={tabClass(tab === "videos")} data-testid="tab-videos">
            Videos · {clips.length}
          </button>
          <button type="button" onClick={() => setTab("photos")} className={tabClass(tab === "photos")} data-testid="tab-photos">
            Photos · {photos.length}
          </button>
          <div className="ml-auto">
            {tab === "videos" && canEdit && (
              <ChunkedVideoUploader onComplete={handleClipsUpload} routeStartTime={routeStartTime} buttonClassName={addButtonClass}>
                + Add
              </ChunkedVideoUploader>
            )}
            {tab === "photos" && canEdit && (
              <AutoPhotoUploader
                maxNumberOfFiles={MAX_TRIP_PHOTOS}
                existingPhotoCount={photos.length}
                acknowledgedUploadIds={acknowledgedUploadIds}
                maxFileSize={52428800}
                onGetUploadParameters={getPhotoUploadParameters}
                onComplete={handlePhotosUploaded}
                buttonClassName={addPhotoButtonClass}
              >
                <span>+ Add</span>
              </AutoPhotoUploader>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {tab === "videos" ? (
            <>
              {selectedClip && (
                <div className="p-3 pb-0">
                  <div className="relative aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
                    {selectedClip.processingStatus === "ready" ? (
                      <video
                        // A new element per clip, so switching clips reloads the source.
                        key={selectedClip.id}
                        ref={videoRef}
                        className="w-full h-full object-contain"
                        controls
                        playsInline
                        onLoadedData={(e) => {
                          if (autoplayClipId.current !== selectedClip.id) return;
                          autoplayClipId.current = null;
                          void e.currentTarget.play().catch(() => {});
                        }}
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        onPlay={() => {
                          setIsPlaying(true);
                          // The trip card folds so the video gets the column; its header reopens it.
                          setInfoOpen(false);
                          // Every play goes back to the chase view behind the pin.
                          setMapFocus({ id: selectedClip.id, nonce: Date.now() });
                        }}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        data-testid="video-player"
                      >
                        <source src={`/api/video-clips/${selectedClip.id}/stream`} type="video/mp4" />
                        Your browser does not support the video tag.
                      </video>
                    ) : selectedClip.processingStatus === "error" ? (
                      <div className="text-center text-white p-4">
                        <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-400" />
                        <p className="font-serif text-lg text-gray-200">Video processing failed</p>
                        <p className="meta-mono text-gray-500 mt-1">{selectedClip.processingError || "Unknown error"}</p>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => retryProcessing(selectedClip.id)}
                            className="meta-mono text-white underline underline-offset-4 hover:opacity-70 mt-3 inline-flex items-center gap-1.5"
                            data-testid="button-reprocess"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Retry processing →
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center text-white p-4">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-gray-400" />
                        <p className="font-serif text-lg text-gray-200">Processing…</p>
                        <p className="meta-mono text-gray-500 mt-1">
                          {isStuck(selectedClip) ? "Not running. It may have been interrupted." : "Transcoding to 1080p"}
                        </p>
                        {canEdit && isStuck(selectedClip) && (
                          <button
                            type="button"
                            onClick={() => retryProcessing(selectedClip.id)}
                            className="meta-mono text-white underline underline-offset-4 hover:opacity-70 mt-3 inline-flex items-center gap-1.5"
                            data-testid="button-reprocess-stuck"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Retry processing →
                          </button>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={closePlayer}
                      className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white/90 hover:text-white"
                      aria-label="Close player"
                      data-testid="button-close-player"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <span className="text-sm text-foreground truncate">{selectedClip.title}</span>
                    {/* Lining the pin up with the video stays a wide-screen, owner-only tool. */}
                    {canEdit && !isMobile && selectedClip.processingStatus === "ready" && (
                      <div className="flex items-center gap-2 meta-mono text-muted-foreground flex-shrink-0" data-testid="sync-controls">
                        <span title="Seconds the pin is shifted to line the camera clock up with the GPS">
                          Sync {syncOffset >= 0 ? "+" : "−"}
                          {Math.abs(syncOffset).toFixed(1)} s
                        </span>
                        <button
                          type="button"
                          onClick={() => changeSyncOffset(syncOffset - 0.5)}
                          className="border border-border rounded px-1.5 hover:text-foreground"
                          title="Pin earlier by half a second"
                          data-testid="button-sync-earlier"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          onClick={() => changeSyncOffset(syncOffset + 0.5)}
                          className="border border-border rounded px-1.5 hover:text-foreground"
                          title="Pin later by half a second"
                          data-testid="button-sync-later"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCalibrating((on) => !on);
                            videoRef.current?.pause();
                          }}
                          className={`border rounded px-2 ${
                            calibrating ? "border-foreground text-foreground" : "border-border hover:text-foreground"
                          }`}
                          data-testid="button-calibrate"
                        >
                          {calibrating ? "Done" : "Calibrate"}
                        </button>
                        {calibrating && cameraAngle && (
                          <button
                            type="button"
                            onClick={() => changeCameraAngle(null)}
                            className="border border-border rounded px-2 hover:text-foreground"
                            title="Go back to the default chase-cam angle"
                            data-testid="button-reset-camera-angle"
                          >
                            Reset angle
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {calibrating && (
                    <p className="meta-mono text-foreground bg-muted/60 rounded px-3 py-2 mt-2">
                      Pause on something you can spot on the map, like a junction or a bridge, then drag the pin to
                      where you really are. Then pan, zoom, tilt and turn the map to set the follow-cam's angle. The
                      sync and the angle are saved for every clip on this trip.
                    </p>
                  )}
                </div>
              )}

              {clips.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="font-serif text-muted-foreground">No videos yet.</p>
                  {canEdit && !timedTrack && (
                    <p className="meta-mono text-muted-foreground mt-2">
                      This trip's route has no timestamps, so videos you add will play but won't be placed on the map.
                    </p>
                  )}
                </div>
              ) : (
                <div
                  className={`grid gap-2 p-3 ${playerOpen && !isMobile ? "grid-cols-2" : "grid-cols-1"}`}
                  data-testid="clip-list"
                >
                  {clips.map((clip, index) => {
                    const ready = clip.processingStatus === "ready";
                    const errored = clip.processingStatus === "error";
                    const stuck = isStuck(clip);
                    return (
                      <div
                        key={clip.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openClip(clip)}
                        onMouseEnter={() => { if (!isMobile) hoverClip(clip.id); }}
                        onMouseLeave={() => hoverClip(null)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            openClip(clip);
                          }
                        }}
                        className={`flex gap-3 rounded border p-1.5 cursor-pointer transition-colors hover:border-foreground/60 ${
                          selectedClip?.id === clip.id ? "border-foreground bg-muted/50" : "border-border"
                        }`}
                        data-testid={`clip-card-${clip.id}`}
                      >
                        <div className="relative w-24 aspect-video flex-shrink-0 bg-black rounded-sm overflow-hidden flex items-center justify-center">
                          {clip.thumbnailUrl ? (
                            <img
                              src={`/api/video-clips/${clip.id}/thumbnail`}
                              alt={clip.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Video className="h-4 w-4 text-gray-500" />
                          )}
                          {!ready && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              {errored ? (
                                <AlertTriangle className="h-4 w-4 text-red-400" />
                              ) : (
                                <Loader2 className="h-4 w-4 animate-spin text-white" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col justify-center">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: clipColor(clip, index) }}
                            />
                            <h4 className="text-sm text-foreground truncate flex-1">{clip.title}</h4>
                            {/* Popover content is portaled, but its React events still bubble to the card. */}
                            {canEdit && !isMobile && (
                              <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <ClipEditPopover
                                  clip={clip}
                                  color={clipColor(clip, index)}
                                  palette={clipColors}
                                  saving={updateClipMutation.isPending && updateClipMutation.variables?.id === clip.id}
                                  onSave={(updates) => updateClipMutation.mutateAsync({ id: clip.id, updates })}
                                />
                              </span>
                            )}
                          </div>
                          <div className="meta-mono text-muted-foreground mt-0.5">
                            {formatTime(clip.startTime)} → {formatTime(clip.endTime)}
                            {!ready && !errored && <span> · {stuck ? "Stuck" : "Processing…"}</span>}
                            {errored && <span className="text-destructive"> · Failed</span>}
                          </div>
                          {canEdit && (errored || stuck) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                retryProcessing(clip.id);
                              }}
                              className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity mt-1 text-left inline-flex items-center gap-1 self-start"
                              data-testid={`button-retry-${clip.id}`}
                            >
                              <RefreshCw className="h-3 w-3" />
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : photos.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="font-serif text-muted-foreground">No photos yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-2 gap-2 p-3" data-testid="photo-grid">
              {photos.map((photo, index) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onOpenPhoto(photo.id)}
                  className="block aspect-square overflow-hidden rounded-sm bg-muted"
                  data-testid={`photo-thumbnail-${photo.id}`}
                >
                  <img
                    src={photo.url}
                    alt={photo.altText || `Trip photo ${index + 1}`}
                    loading="lazy"
                    className="w-full h-full object-cover transition-opacity hover:opacity-90"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}
