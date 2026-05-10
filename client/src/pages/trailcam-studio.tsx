import { useRef, useState, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
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
import { NewProjectModal } from "@/components/new-project-modal";
import { ChunkedVideoUploader } from "@/components/chunked-video-uploader";
import MapboxMap, { ClipMarker } from "@/components/mapbox-map";
import type { TrailcamProject, VideoClip, InsertVideoClip } from "@shared/schema";

function pillButtonClass(active = false) {
  return `meta-mono px-3 py-1.5 rounded-full border transition-colors ${
    active
      ? "border-foreground text-foreground bg-muted"
      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
  }`;
}

export default function TrailcamStudio() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<TrailcamProject | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<TrailcamProject[]>({
    queryKey: ["/api/trailcam-projects"],
    queryFn: async () => {
      const response = await fetch("/api/trailcam-projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });

  const { data: clips = [] } = useQuery<VideoClip[]>({
    queryKey: ["/api/video-clips", selectedProject?.id],
    queryFn: async () => {
      if (!selectedProject?.id) return [];
      const response = await fetch(`/api/video-clips?projectId=${selectedProject.id}`);
      if (!response.ok) throw new Error("Failed to fetch clips");
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

  const createClipMutation = useMutation({
    mutationFn: async (clipData: InsertVideoClip) => {
      const response = await fetch("/api/video-clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clipData),
      });
      if (!response.ok) throw new Error("Failed to create video clip");
      return response.json();
    },
    onSuccess: (clip: VideoClip) => {
      toast({ title: "Clip added", description: `"${clip.title}"` });
      queryClient.invalidateQueries({ queryKey: ["/api/video-clips", selectedProject?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Error", description: error.message || "Failed to add video clip", variant: "destructive" }),
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
      projectId: selectedProject.id,
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

  const clipColors = [
    "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981",
    "#ef4444", "#f97316", "#6366f1", "#84cc16",
  ];

  const clipMarkers: ClipMarker[] = selectedClip
    ? (() => {
        const markers: ClipMarker[] = [];
        const clipIndex = clips.findIndex((c) => c.id === selectedClip.id);
        const color = clipIndex >= 0 ? clipColors[clipIndex % clipColors.length] : clipColors[0];
        if (selectedClip.startLatitude != null && selectedClip.startLongitude != null) {
          markers.push({
            id: selectedClip.id, type: "start",
            latitude: selectedClip.startLatitude, longitude: selectedClip.startLongitude, color,
          });
        }
        if (selectedClip.endLatitude != null && selectedClip.endLongitude != null) {
          markers.push({
            id: selectedClip.id, type: "end",
            latitude: selectedClip.endLatitude, longitude: selectedClip.endLongitude, color,
          });
        }
        return markers;
      })()
    : [];

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!selectedProject) {
    return (
      <div className="min-h-screen bg-background">
        <main className="px-5 sm:px-8 pt-6 pb-16 max-w-6xl mx-auto">
          {/* Page header */}
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="meta-mono text-muted-foreground mb-3">
                TrailCam · projects {projects.length > 0 && `· ${projects.length}`}
              </div>
              <h1
                className="font-serif text-foreground"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, letterSpacing: "-0.015em" }}
              >
                TrailCam Studio
              </h1>
              <p className="font-serif text-lg text-foreground/70 mt-3 max-w-xl leading-relaxed">
                Sync video clips with GPS route data. Pick an existing project or start a new one.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewProjectModal(true)}
              className={pillButtonClass()}
              data-testid="button-new-project"
            >
              + New project
            </button>
          </div>

          {/* Projects */}
          {projectsLoading ? (
            <div className="meta-mono text-muted-foreground py-12">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="border-t border-border py-20 text-center">
              <p className="font-serif text-2xl text-muted-foreground mb-4">No projects yet.</p>
              <button
                type="button"
                onClick={() => setShowNewProjectModal(true)}
                className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70"
                data-testid="button-create-first-project"
              >
                Create your first →
              </button>
            </div>
          ) : (
            <div className="border-t border-border divide-y divide-border">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProject(project)}
                  className="w-full text-left py-5 flex items-start justify-between gap-6 group hover:bg-muted/30 -mx-5 sm:-mx-8 px-5 sm:px-8 transition-colors"
                  data-testid={`tile-project-${project.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif text-2xl text-foreground group-hover:underline underline-offset-4">
                      {project.title}
                    </h3>
                    {project.description && (
                      <p className="text-foreground/70 mt-1 line-clamp-2">{project.description}</p>
                    )}
                    <div className="meta-mono text-muted-foreground mt-2 flex flex-wrap gap-x-3">
                      {project.duration && <span>{formatTime(project.duration)}</span>}
                      {project.startTime && (
                        <>
                          {project.duration && <span>·</span>}
                          <span>{new Date(project.startTime).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="meta-mono text-muted-foreground group-hover:text-foreground transition-colors">
                    Open →
                  </span>
                </button>
              ))}
            </div>
          )}
        </main>

        <NewProjectModal
          isOpen={showNewProjectModal}
          onClose={() => setShowNewProjectModal(false)}
          onProjectCreated={(project) => {
            setSelectedProject(project);
            setShowNewProjectModal(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-2.75rem)] bg-background flex flex-col overflow-hidden">
      {/* Paper-thin header */}
      <div className="px-5 sm:px-8 py-3 border-b border-border flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            onClick={() => setSelectedProject(null)}
            className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 flex-shrink-0"
            data-testid="button-back-to-projects"
          >
            <ArrowLeft className="h-3 w-3" />
            Projects
          </button>
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
        <ChunkedVideoUploader onComplete={handleClipUpload} buttonClassName={pillButtonClass()}>
          + Add clip
        </ChunkedVideoUploader>
      </div>

      {/* Main split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — Map */}
        <div className="w-1/2 border-r border-border flex flex-col">
          <div className="px-5 py-2.5 border-b border-border meta-mono text-muted-foreground flex items-center gap-1.5">
            <MapIcon className="h-3 w-3" />
            Map
          </div>
          <div className="flex-1 bg-muted/20">
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full meta-mono text-muted-foreground">
                  Loading map…
                </div>
              }
            >
              <MapboxMap
                gpxData={selectedProject.gpxData}
                clipMarkers={clipMarkers}
                className="w-full h-full"
              />
            </Suspense>
          </div>
        </div>

        {/* Right — Video & Timeline */}
        <div className="w-1/2 flex flex-col">
          {/* Video */}
          <div className="flex-1 border-b border-border flex flex-col">
            <div className="px-5 py-2.5 border-b border-border flex items-center justify-between gap-3">
              <span className="meta-mono text-muted-foreground flex items-center gap-1.5">
                <Video className="h-3 w-3" />
                Video clip
              </span>
              {selectedClip && (
                <span className="meta-mono text-foreground truncate">{selectedClip.title}</span>
              )}
            </div>
            <div className="flex-1 bg-black flex items-center justify-center relative">
              {selectedClip ? (
                selectedClip.processingStatus === "ready" ? (
                  <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    controls
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
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
                      onClick={() => {
                        fetch(`/api/video-clips/${selectedClip.id}/reprocess`, { method: "POST" })
                          .then(() => {
                            toast({ title: "Reprocessing started" });
                            queryClient.invalidateQueries({ queryKey: ["/api/video-clips", selectedProject?.id] });
                          })
                          .catch(() =>
                            toast({ title: "Error", description: "Failed to reprocess video", variant: "destructive" }),
                          );
                      }}
                      className="meta-mono text-white underline underline-offset-4 hover:opacity-70 mt-5 inline-flex items-center gap-1.5"
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
                    <p className="meta-mono text-gray-500 mt-1">Transcoding to 1080p</p>
                  </div>
                )
              ) : (
                <div className="text-center text-white">
                  <Video className="h-12 w-12 mx-auto mb-4 text-gray-500" />
                  <p className="font-serif text-xl text-gray-200">Select a clip to play</p>
                  <p className="meta-mono text-gray-500 mt-2">
                    Upload clips and choose preview to start
                  </p>
                </div>
              )}

              {selectedClip && selectedClip.processingStatus === "ready" && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 rounded-full px-4 py-2 backdrop-blur-sm">
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
          <div className="h-64 flex flex-col">
            <div className="px-5 py-2.5 border-b border-border flex items-center justify-between gap-3">
              <span className="meta-mono text-muted-foreground">Timeline · elevation</span>
              <span className="meta-mono text-muted-foreground">{formatTime(currentTime)}</span>
            </div>

            <div className="h-16 px-5 py-2 border-b border-border">
              <div className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded opacity-60" />
              <div className="meta-mono text-muted-foreground mt-1">Elevation profile</div>
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
                    const color = clipColors[index % clipColors.length];
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
                        onClick={() => setSelectedClip(clip)}
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
                        ? `${(currentTime / selectedProject.duration) * 100}%`
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
      <div className="h-48 border-t border-border flex flex-col flex-shrink-0">
        <div className="px-5 py-2.5 border-b border-border flex items-center justify-between">
          <span className="meta-mono text-muted-foreground">Clips · {clips.length}</span>
          <ChunkedVideoUploader
            onComplete={handleClipUpload}
            buttonClassName="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 bg-transparent border-0 p-0 cursor-pointer"
          >
            + Add clip
          </ChunkedVideoUploader>
        </div>

        <div className="flex-1 overflow-x-auto px-5 py-3">
          {clips.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <p className="font-serif text-muted-foreground">No clips added yet.</p>
            </div>
          ) : (
            <div className="flex gap-3 h-full">
              {clips.map((clip, index) => {
                const ready = clip.processingStatus === "ready";
                const errored = clip.processingStatus === "error";
                return (
                  <div
                    key={clip.id}
                    className="w-44 flex-shrink-0 border border-border rounded overflow-hidden bg-card flex flex-col"
                    data-testid={`clip-card-${clip.id}`}
                  >
                    <div className="h-20 bg-black flex items-center justify-center relative flex-shrink-0">
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
                    <div className="p-2.5 flex-1 flex flex-col">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <h4 className="text-sm text-foreground truncate">{clip.title}</h4>
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: clipColors[index % clipColors.length] }}
                        />
                      </div>
                      <div className="meta-mono text-muted-foreground flex gap-x-2">
                        <span>{formatTime(clip.startTime)}</span>
                        <span>→</span>
                        <span>{formatTime(clip.endTime)}</span>
                      </div>
                      {!ready && !errored && (
                        <div className="meta-mono text-muted-foreground mt-1">Processing…</div>
                      )}
                      {errored && (
                        <div className="meta-mono text-destructive mt-1">Failed</div>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedClip(clip)}
                        disabled={!ready && !errored}
                        className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity disabled:opacity-40 disabled:no-underline mt-auto pt-2 text-left"
                        data-testid={`button-preview-${clip.id}`}
                      >
                        {!ready && !errored ? "Processing" : "Preview →"}
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
