import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import "./trip-video-studio.css";
import {
  ArrowLeft,
  Video,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Map as MapIcon,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { ChunkedVideoUploader } from "@/components/chunked-video-uploader";
import { ClipEditPopover } from "@/components/clip-edit-popover";
import MapboxMap, { CameraAngle, ClipMarker, ClipSegment } from "@/components/mapbox-map";
import { compactTimedTrack, nearestTrackOffset, parseGpxData, trackBearingAt, trackPositionAt, trackSegmentBetween, type CompactTimedTrack } from "@shared/gpx-utils";
import type { FieldNote, TripPlayback, VideoClip, InsertVideoClip } from "@shared/schema";
import { ApiError, apiRequest } from "@/lib/queryClient";

type StudioClip = VideoClip & { processingActive?: boolean };

// A clip still marked pending or processing that the server isn't working on
// lost its job (for example when the server was stopped mid-transcode).
function isStuck(clip: StudioClip) {
  return (
    (clip.processingStatus === "pending" || clip.processingStatus === "processing") &&
    clip.processingActive === false
  );
}

function pillButtonClass(active = false) {
  return `meta-mono px-3 py-1.5 rounded-full border transition-colors ${
    active
      ? "border-foreground text-foreground bg-muted"
      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
  }`;
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

/**
 * Synced video playback for a trip with clips: the route map with a live pin,
 * the player, the clip timeline and calibration. Shown on the trip page.
 */
export default function TripVideoStudio({ trip }: { trip: FieldNote }) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const projectViewportRef = useRef<HTMLDivElement>(null);
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
  // Seconds added to every clip's place on the route, to line the camera's
  // clock up with the GPS clock. Saved on the project.
  const [syncOffset, setSyncOffset] = useState(0);
  // While on, dragging the pin moves the sync instead of the video.
  const [calibrating, setCalibrating] = useState(false);
  useEffect(() => {
    if (isMobile) setCalibrating(false);
  }, [isMobile]);

  // Measure actual chrome (including a wrapping preview banner or open header
  // drawer), rather than assuming that everything above the viewer is 44px.
  useEffect(() => {
    if (!selectedProject || !isMobile) return;
    const chrome = document.querySelectorAll<HTMLElement>("[data-global-header], [data-preview-banner]");
    const updateHeight = () => {
      const height = Array.from(chrome).reduce((total, element) => total + element.getBoundingClientRect().height, 0);
      projectViewportRef.current?.style.setProperty("--studio-chrome-height", `${height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    chrome.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [selectedProject?.id, isMobile]);
  const saveSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The 3D follow-cam's angle, set by moving the map in calibrate mode.
  // Saved on the project; null plays with the default chase-cam.
  const [cameraAngle, setCameraAngle] = useState<CameraAngle | null>(null);
  const saveAngleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeAfterDrag = useRef(false);
  // The clip under the pointer in the library or timeline. The map zooms to
  // it and hides the rest. Small delays keep a quick sweep across the cards
  // from bouncing the map around.
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


  const { data: clips = [] } = useQuery<StudioClip[]>({
    queryKey: ["/api/video-clips", selectedProject?.id],
    queryFn: async () => {
      if (!selectedProject?.id) return [];
      const response = await apiRequest(`/api/video-clips?tripId=${selectedProject.id}`, "GET");
      return response.json();
    },
    enabled: !!selectedProject?.id,
    refetchInterval: (query) => {
      const hasProcessing = query.state.data?.some(
        (clip) => clip.processingStatus !== "ready" && clip.processingStatus !== "error",
      );
      return hasProcessing ? 3000 : false;
    },
  });

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

  const createClipMutation = useMutation({
    mutationFn: async (clipData: InsertVideoClip) => {
      const response = await apiRequest("/api/video-clips", "POST", clipData);
      return response.json();
    },
    onSuccess: (clip: VideoClip) => {
      toast({ title: "Clip added", description: `"${clip.title}"` });
      queryClient.invalidateQueries({ queryKey: ["/api/video-clips", selectedProject?.id] });
      // The trip's video count changed, for the dashboard and its filter.
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message || "Failed to add video clip", variant: "destructive" }),
  });

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

  const handleClipUpload = (clipData: {
    title: string;
    filename: string;
    url: string;
    startTime: number;
    endTime: number;
    duration: number;
    color: string;
    fileSize: string;
    videoFormat: string;
  }) => {
    if (!selectedProject?.id) return;
    createClipMutation.mutate({
      fieldNoteId: selectedProject.id,
      title: clipData.title,
      filename: clipData.filename,
      url: clipData.url,
      startTime: clipData.startTime,
      endTime: clipData.endTime,
      duration: clipData.duration,
      color: clipData.color,
      fileSize: clipData.fileSize,
      videoFormat: clipData.videoFormat,
    });
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

  return (
    <div ref={projectViewportRef} className="studio-project h-[calc(100vh-2.75rem)] bg-background flex flex-col overflow-hidden">
      {/* Paper-thin header */}
      <div className="studio-desktop-only px-5 sm:px-8 py-3 border-b border-border flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href="/dashboard"
            className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 flex-shrink-0"
            data-testid="button-back-to-trips"
          >
            <ArrowLeft className="h-3 w-3" />
            Trips
          </Link>
          <span className="text-border">·</span>
          <h1 className="font-serif text-xl text-foreground truncate">{selectedProject.title}</h1>
          <div className="meta-mono text-muted-foreground hidden md:flex gap-x-3">
            <span>·</span>
            <span>Route.gpx</span>
            {selectedProject.duration && (
              <>
                <span>·</span>
                <span>{formatTime(selectedProject.duration)}</span>
              </>
            )}
          </div>
        </div>
        <ChunkedVideoUploader onComplete={handleClipUpload} routeStartTime={routeStartTime} buttonClassName={pillButtonClass()}>
          + Add clip
        </ChunkedVideoUploader>
      </div>

      {/* Main split */}
      <div className="studio-split flex-1 min-h-0 min-w-0 flex overflow-hidden">
        {/* Left — Map */}
        <div className="studio-map-panel w-1/2 min-h-0 min-w-0 border-r border-border flex flex-col">
          <div className="studio-desktop-only px-5 py-2.5 border-b border-border meta-mono text-muted-foreground flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <MapIcon className="h-3 w-3" />
              Map
            </span>
            <div className="flex items-center gap-2" data-testid="sync-controls">
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
          </div>
          {calibrating && (
            <div className="studio-desktop-only px-5 py-2 border-b border-border meta-mono text-foreground bg-muted/40">
              Pause on something you can spot on the map, like a junction or a bridge, then drag the pin to where
              you really are. Then pan, zoom, tilt and turn the map to set the follow-cam's angle. The sync and the
              angle are saved for every clip in this project.
            </div>
          )}
          <div className="studio-map-surface flex-1 min-h-0 min-w-0 bg-muted/20">
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full meta-mono text-muted-foreground">
                  Loading map…
                </div>
              }
            >
              <MapboxMap
                gpxData={selectedProject.gpxData}
                showTerrainControls
                cameraAngle={cameraAngle}
                onCameraAngleChange={calibrating && !isMobile ? changeCameraAngle : undefined}
                banner={calibrating ? "Pan and zoom to the angle you'd like this clip to start at" : null}
                clipMarkers={clipMarkers}
                clipSegments={clipSegments}
                selectedSegmentId={selectedClip?.id ?? null}
                previewSegmentId={hoveredClipId}
                onClipSegmentClick={(clipId) => {
                  const clip = clips.find((c) => c.id === clipId);
                  if (clip) playClip(clip);
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
        </div>

        {/* Right — Video & Timeline */}
        <div className="studio-player-column w-1/2 min-h-0 min-w-0 flex flex-col">
          {/* Video */}
          <div className="studio-video-panel flex-1 min-h-0 min-w-0 border-b border-border flex flex-col">
            <div className="studio-desktop-only px-5 py-2.5 border-b border-border flex items-center justify-between gap-3">
              <span className="meta-mono text-muted-foreground flex items-center gap-1.5">
                <Video className="h-3 w-3" />
                Video clip
              </span>
              {selectedClip && (
                <span className="meta-mono text-foreground truncate">{selectedClip.title}</span>
              )}
            </div>
            <div className="studio-video-surface flex-1 min-h-0 min-w-0 bg-black flex items-center justify-center relative">
              {selectedClip ? (
                selectedClip.processingStatus === "ready" ? (
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
                  <div className="text-center text-white p-6">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-red-400" />
                    <p className="font-serif text-xl text-gray-200">Video processing failed</p>
                    <p className="meta-mono text-gray-500 mt-2">
                      {selectedClip.processingError || "Unknown error"}
                    </p>
                    <button
                      type="button"
                      onClick={() => retryProcessing(selectedClip.id)}
                      className="studio-desktop-only meta-mono text-white underline underline-offset-4 hover:opacity-70 mt-5 inline-flex items-center gap-1.5"
                      data-testid="button-reprocess"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Retry processing →
                    </button>
                  </div>
                ) : (
                  <div className="text-center text-white">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-gray-400" />
                    <p className="font-serif text-lg text-gray-200">Processing…</p>
                    <p className="meta-mono text-gray-500 mt-1">
                      {isStuck(selectedClip) ? "Not running. It may have been interrupted." : "Transcoding to 1080p"}
                    </p>
                    {isStuck(selectedClip) && (
                      <button
                        type="button"
                        onClick={() => retryProcessing(selectedClip.id)}
                        className="studio-desktop-only meta-mono text-white underline underline-offset-4 hover:opacity-70 mt-5 inline-flex items-center gap-1.5"
                        data-testid="button-reprocess-stuck"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry processing →
                      </button>
                    )}
                  </div>
                )
              ) : (
                <div className="text-center text-white">
                  <Video className="h-12 w-12 mx-auto mb-4 text-gray-500" />
                  <p className="font-serif text-xl text-gray-200">Select a clip to play</p>
                  <p className="meta-mono text-gray-500 mt-2">
                    {isMobile ? "Tap a clip below to start" : "Upload clips and choose preview to start"}
                  </p>
                </div>
              )}

              {selectedClip && selectedClip.processingStatus === "ready" && (
                <div className="studio-desktop-only absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 rounded-full px-4 py-2 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                      }
                    }}
                    className="text-white/80 hover:text-white"
                    data-testid="button-skip-back"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!videoRef.current) return;
                      if (isPlaying) videoRef.current.pause();
                      else videoRef.current.play();
                    }}
                    className="text-white"
                    data-testid="button-play-pause"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Math.min(
                          videoRef.current.duration || 0,
                          videoRef.current.currentTime + 10,
                        );
                      }
                    }}
                    className="text-white/80 hover:text-white"
                    data-testid="button-skip-forward"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                  <span className="meta-mono text-white/70 ml-1">
                    {formatTime(currentTime)} / {videoRef.current?.duration ? formatTime(videoRef.current.duration) : "0:00"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="studio-desktop-only h-64 flex flex-col">
            <div className="px-5 py-2.5 border-b border-border flex items-center justify-between gap-3">
              <span className="meta-mono text-muted-foreground">Timeline</span>
              <span className="meta-mono text-muted-foreground">{formatTime(currentTime)}</span>
            </div>

            <div className="flex-1 px-5 py-3">
              <div className="relative h-full">
                <div className="h-5 border-b border-border relative mb-2 meta-mono text-muted-foreground">
                  <span className="absolute left-0 bottom-1">0:00</span>
                  {selectedProject.duration && (
                    <span className="absolute right-0 bottom-1">{formatTime(selectedProject.duration)}</span>
                  )}
                </div>

                <div className="relative h-12 bg-muted/30 rounded">
                  {clips.map((clip, index) => {
                    const color = clipColor(clip, index);
                    const leftPercent = selectedProject.duration
                      ? (clip.startTime / selectedProject.duration) * 100
                      : 0;
                    const widthPercent = selectedProject.duration
                      ? ((clip.endTime - clip.startTime) / selectedProject.duration) * 100
                      : 20;

                    return (
                      <button
                        key={clip.id}
                        type="button"
                        className="absolute top-1 h-10 rounded cursor-pointer hover:opacity-80 transition-opacity overflow-hidden"
                        style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, backgroundColor: color }}
                        onClick={() => playClip(clip)}
                        onMouseEnter={() => hoverClip(clip.id)}
                        onMouseLeave={() => hoverClip(null)}
                        data-testid={`clip-segment-${clip.id}`}
                      >
                        <div className="meta-mono text-white p-1 truncate text-left">
                          {clip.title}
                        </div>
                      </button>
                    );
                  })}

                  <div
                    className="absolute top-0 w-px h-full bg-foreground z-10 pointer-events-none"
                    style={{
                      left: selectedProject.duration
                        ? `${(((selectedClip?.startTime ?? 0) + currentTime) / selectedProject.duration) * 100}%`
                        : "0%",
                    }}
                  >
                    <div className="absolute -top-1 -left-1 w-2 h-2 bg-foreground rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom — Clips library */}
      <div className="studio-clips-panel h-48 border-t border-border flex flex-col flex-shrink-0">
        <div className="studio-clips-heading px-5 py-2.5 border-b border-border flex items-center justify-between">
          <span className="meta-mono text-muted-foreground">Clips · {clips.length}</span>
          <div className="studio-desktop-only">
          <ChunkedVideoUploader
            onComplete={handleClipUpload}
            routeStartTime={routeStartTime}
            buttonClassName="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 bg-transparent border-0 p-0 cursor-pointer"
          >
            + Add clip
          </ChunkedVideoUploader>
          </div>
        </div>

        <div className="studio-clips-scroll flex-1 overflow-x-auto px-5 py-3">
          {clips.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="font-serif text-muted-foreground">No clips added yet.</p>
            </div>
          ) : (
            <div className="studio-clips-list flex gap-3 h-full">
              {clips.map((clip, index) => {
                const ready = clip.processingStatus === "ready";
                const errored = clip.processingStatus === "error";
                const stuck = isStuck(clip);
                return (
                  <div
                    key={clip.id}
                    role={ready ? "button" : undefined}
                    tabIndex={ready ? 0 : undefined}
                    onClick={() => playClip(clip)}
                    onMouseEnter={() => { if (!isMobile) hoverClip(clip.id); }}
                    onMouseLeave={() => hoverClip(null)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        playClip(clip);
                      }
                    }}
                    className={`studio-clip-card w-44 flex-shrink-0 border rounded overflow-hidden bg-card flex flex-col ${
                      selectedClip?.id === clip.id ? "border-foreground" : "border-border"
                    } ${ready ? "cursor-pointer hover:border-foreground/60 transition-colors" : ""}`}
                    data-testid={`clip-card-${clip.id}`}
                  >
                    <div className="studio-clip-thumbnail h-20 bg-black flex items-center justify-center relative flex-shrink-0">
                      {clip.thumbnailUrl ? (
                        <img
                          src={`/api/video-clips/${clip.id}/thumbnail`}
                          alt={clip.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Video className="h-5 w-5 text-gray-500" />
                      )}
                      {ready ? (
                        <div className="absolute top-1 right-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                        </div>
                      ) : errored ? (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <AlertTriangle className="h-5 w-5 text-red-400" />
                        </div>
                      ) : (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        </div>
                      )}
                    </div>
                    <div className="studio-clip-details p-2.5 flex-1 flex flex-col">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <h4 className="text-sm text-foreground truncate">{clip.title}</h4>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: clipColor(clip, index) }}
                          />
                          {/* Popover content is portaled, but its React events still bubble to the card. */}
                          <span className="studio-desktop-only" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          {!isMobile && <ClipEditPopover
                            clip={clip}
                            color={clipColor(clip, index)}
                            palette={clipColors}
                            saving={updateClipMutation.isPending && updateClipMutation.variables?.id === clip.id}
                            onSave={(updates) => updateClipMutation.mutateAsync({ id: clip.id, updates })}
                          />}
                          </span>
                        </div>
                      </div>
                      <div className="meta-mono text-muted-foreground flex gap-x-2">
                        <span>{formatTime(clip.startTime)}</span>
                        <span>→</span>
                        <span>{formatTime(clip.endTime)}</span>
                      </div>
                      {!ready && !errored && (
                        <div className="meta-mono text-muted-foreground mt-1">{stuck ? "Stuck" : "Processing…"}</div>
                      )}
                      {errored && (
                        <div className="meta-mono text-destructive mt-1">Failed</div>
                      )}
                      {(errored || stuck) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryProcessing(clip.id);
                          }}
                          className="studio-desktop-only meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity mt-1 text-left inline-flex items-center gap-1"
                          data-testid={`button-retry-${clip.id}`}
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playClip(clip);
                        }}
                        disabled={!ready && !errored}
                        className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity disabled:opacity-40 disabled:no-underline mt-auto pt-2 text-left"
                        data-testid={`button-preview-${clip.id}`}
                      >
                        {!ready && !errored ? "Processing" : ready ? "Play →" : "Details →"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
