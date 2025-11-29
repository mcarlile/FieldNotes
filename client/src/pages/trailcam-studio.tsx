import { useState, useEffect, useRef, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { 
  Grid,
  Column,
  Button as CarbonButton,
  FileUploader,
  TextInput,
  TextArea,
  Loading,
  Tile,
  Tag,
  ProgressBar,
  SkeletonText,
  SkeletonPlaceholder,
  ContentSwitcher,
  Switch,
} from "@carbon/react";
import { 
  ArrowLeft, 
  Video, 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack,
  Upload,
  Add,
  Edit,
  TrashCan,
  Map,
  ChartLineSmooth,
} from "@carbon/icons-react";
import { useTheme } from "@/contexts/theme-context";
import { NewProjectModal } from "@/components/new-project-modal";
import { ChunkedVideoUploader } from "@/components/chunked-video-uploader";
import MapboxMap from "@/components/mapbox-map";
import type { TrailcamProject, VideoClip, InsertVideoClip } from "@shared/schema";

export default function TrailcamStudio() {
  const { theme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<TrailcamProject | null>(null);
  const [currentTime, setCurrentTime] = useState(0); // Current playback position in seconds
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState<VideoClip | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Mock data for now - will be replaced with real API calls
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
  });

  // Create video clip mutation
  const createClipMutation = useMutation({
    mutationFn: async (clipData: InsertVideoClip) => {
      const response = await fetch("/api/video-clips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(clipData),
      });
      
      if (!response.ok) {
        throw new Error("Failed to create video clip");
      }
      
      return response.json();
    },
    onSuccess: (clip: VideoClip) => {
      toast({
        title: "Success",
        description: `Video clip "${clip.title}" added successfully!`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/video-clips", selectedProject?.id] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add video clip",
        variant: "destructive",
      });
    },
  });

  // Handle video clip upload completion
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

    const insertData: InsertVideoClip = {
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
    };

    createClipMutation.mutate(insertData);
  };

  // Color palette for timeline clips
  const clipColors = [
    "#3b82f6", // blue
    "#8b5cf6", // purple
    "#f59e0b", // orange
    "#10b981", // green
    "#ef4444", // red
    "#f97316", // amber
    "#6366f1", // indigo
    "#84cc16", // lime
  ];

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // If no project is selected, show project selection
  if (!selectedProject) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="bg-card border-b border-border">
          <div className="px-6 py-6">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <Link href="/">
                  <CarbonButton kind="ghost" size="sm" renderIcon={ArrowLeft} data-testid="button-back">
                    Back to Field Notes
                  </CarbonButton>
                </Link>
                <h1 className="text-2xl font-semibold text-foreground">TrailCam Studio</h1>
              </div>
              <CarbonButton 
                size="sm" 
                renderIcon={Add} 
                onClick={() => setShowNewProjectModal(true)}
                data-testid="button-new-project"
              >
                New Project
              </CarbonButton>
            </div>
          </div>
        </div>

        {/* Project Selection */}
        <div className="p-6">
          <Grid fullWidth>
            <Column sm={4} md={8} lg={12}>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-foreground mb-2">Select a Project</h2>
                <p className="text-muted-foreground">Choose an existing project or create a new one to sync video clips with GPS route data.</p>
              </div>

              {projectsLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[1, 2, 3].map((i) => (
                    <Tile key={i} className="p-4">
                      <SkeletonText heading />
                      <SkeletonText paragraph lineCount={2} />
                      <SkeletonPlaceholder className="h-8 w-24 mt-4" />
                    </Tile>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <Tile className="text-center py-12">
                  <Video size={48} className="mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Projects Yet</h3>
                  <p className="text-muted-foreground mb-6">Create your first TrailCam project to start syncing videos with GPS data.</p>
                  <CarbonButton 
                    renderIcon={Add} 
                    onClick={() => setShowNewProjectModal(true)}
                    data-testid="button-create-first-project"
                  >
                    Create First Project
                  </CarbonButton>
                </Tile>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projects.map((project) => (
                    <Tile 
                      key={project.id} 
                      className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelectedProject(project)}
                      data-testid={`tile-project-${project.id}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-lg font-semibold text-foreground">{project.title}</h3>
                        <Video size={20} className="text-muted-foreground" />
                      </div>
                      {project.description && (
                        <p className="text-muted-foreground text-sm mb-3 line-clamp-2">{project.description}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <Tag type="blue" size="sm">
                          {project.duration ? formatTime(project.duration) : 'No duration'}
                        </Tag>
                        {project.startTime && (
                          <Tag type="gray" size="sm">
                            {new Date(project.startTime).toLocaleDateString()}
                          </Tag>
                        )}
                      </div>
                    </Tile>
                  ))}
                </div>
              )}
            </Column>
          </Grid>
        </div>

        {/* New Project Modal */}
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

  // Main TrailCam Studio interface
  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border flex-shrink-0">
        <div className="px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <CarbonButton 
                kind="ghost" 
                size="sm" 
                renderIcon={ArrowLeft}
                onClick={() => setSelectedProject(null)}
                data-testid="button-back-to-projects"
              >
                Projects
              </CarbonButton>
              <h1 className="text-xl font-semibold text-foreground">{selectedProject.title}</h1>
              <div className="flex items-center gap-2">
                <Tag type="blue" size="sm">Route.gpx</Tag>
                {selectedProject.duration && (
                  <Tag type="gray" size="sm">{formatTime(selectedProject.duration)}</Tag>
                )}
              </div>
            </div>
            <CarbonButton size="sm" renderIcon={Upload} data-testid="button-upload-clip">
              Add Clip
            </CarbonButton>
          </div>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side - Map */}
        <div className="w-1/2 bg-card border-r border-border">
          <div className="h-full flex flex-col">
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Map size={20} className="text-muted-foreground" />
                <h2 className="text-lg font-semibold text-foreground">MAP</h2>
              </div>
            </div>
            <div className="flex-1 bg-muted/20">
              <Suspense 
                fallback={
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Map size={64} className="mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground">Loading map...</p>
                    </div>
                  </div>
                }
              >
                <MapboxMap
                  gpxData={selectedProject.gpxData}
                  className="w-full h-full"
                />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Right Side - Video and Timeline */}
        <div className="w-1/2 flex flex-col">
          {/* Video Player */}
          <div className="flex-1 bg-card border-b border-border">
            <div className="h-full flex flex-col">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Video size={20} className="text-muted-foreground" />
                    <h2 className="text-lg font-semibold text-foreground">VIDEO CLIP</h2>
                  </div>
                  {selectedClip && (
                    <Tag type="blue" size="sm">
                      {selectedClip.title}
                    </Tag>
                  )}
                </div>
              </div>
              <div className="flex-1 bg-black flex items-center justify-center relative">
                {selectedClip ? (
                  <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    controls
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    data-testid="video-player"
                  >
                    <source src={selectedClip.url} type={`video/${selectedClip.videoFormat?.toLowerCase() || 'mp4'}`} />
                    Your browser does not support the video tag.
                  </video>
                ) : (
                  <div className="text-center text-white">
                    <Video size={64} className="mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-300">Select a clip to play</p>
                    <p className="text-gray-500 text-sm mt-2">Upload video clips and click PREVIEW to start</p>
                  </div>
                )}
                
                {/* Overlay controls when video is playing */}
                {selectedClip && (
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-black/50 rounded-lg px-4 py-2">
                    <CarbonButton 
                      kind="ghost" 
                      size="sm" 
                      renderIcon={SkipBack}
                      className="text-white"
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                        }
                      }}
                      data-testid="button-skip-back"
                    />
                    <CarbonButton 
                      kind="ghost" 
                      size="lg" 
                      renderIcon={isPlaying ? Pause : Play}
                      className="text-white"
                      onClick={() => {
                        if (videoRef.current) {
                          if (isPlaying) {
                            videoRef.current.pause();
                          } else {
                            videoRef.current.play();
                          }
                        }
                      }}
                      data-testid="button-play-pause"
                    />
                    <CarbonButton 
                      kind="ghost" 
                      size="sm" 
                      renderIcon={SkipForward}
                      className="text-white"
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = Math.min(
                            videoRef.current.duration || 0, 
                            videoRef.current.currentTime + 10
                          );
                        }
                      }}
                      data-testid="button-skip-forward"
                    />
                    <span className="text-white text-sm ml-2">
                      {formatTime(currentTime)} / {videoRef.current?.duration ? formatTime(videoRef.current.duration) : '0:00'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Timeline with Elevation Graph */}
          <div className="h-64 bg-card border-b border-border">
            <div className="h-full flex flex-col">
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <ChartLineSmooth size={20} className="text-muted-foreground" />
                  <h2 className="text-base font-semibold text-foreground">TIMELINE & ELEVATION</h2>
                  <div className="ml-auto text-sm text-muted-foreground">
                    Current: {formatTime(currentTime)}
                  </div>
                </div>
              </div>
              
              {/* Elevation Graph */}
              <div className="h-16 bg-muted/10 border-b border-border px-4 py-2">
                <div className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded opacity-60"></div>
                <div className="text-xs text-muted-foreground mt-1">Elevation Profile</div>
              </div>
              
              {/* Timeline with Clips */}
              <div className="flex-1 p-4">
                <div className="relative h-full">
                  {/* Timeline ruler */}
                  <div className="h-6 border-b border-border relative mb-2">
                    <div className="text-xs text-muted-foreground absolute left-0 bottom-1">0:00</div>
                    {selectedProject.duration && (
                      <div className="text-xs text-muted-foreground absolute right-0 bottom-1">
                        {formatTime(selectedProject.duration)}
                      </div>
                    )}
                  </div>
                  
                  {/* Clip segments */}
                  <div className="relative h-12 bg-muted/20 rounded">
                    {clips.map((clip, index) => {
                      const color = clipColors[index % clipColors.length];
                      const leftPercent = selectedProject.duration 
                        ? (clip.startTime / selectedProject.duration) * 100 
                        : 0;
                      const widthPercent = selectedProject.duration 
                        ? ((clip.endTime - clip.startTime) / selectedProject.duration) * 100 
                        : 20;
                      
                      return (
                        <div
                          key={clip.id}
                          className="absolute top-1 h-10 rounded cursor-pointer hover:opacity-80 transition-opacity"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            backgroundColor: color,
                          }}
                          onClick={() => setSelectedClip(clip)}
                          data-testid={`clip-segment-${clip.id}`}
                        >
                          <div className="text-xs text-white font-medium p-1 truncate">
                            {clip.title}
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Playback marker */}
                    <div 
                      className="absolute top-0 w-0.5 h-full bg-red-500 z-10"
                      style={{
                        left: selectedProject.duration 
                          ? `${(currentTime / selectedProject.duration) * 100}%` 
                          : '0%'
                      }}
                    >
                      <div className="absolute -top-1 -left-1 w-3 h-3 bg-red-500 rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Clips Library */}
      <div className="h-48 bg-card border-t border-border flex-shrink-0">
        <div className="h-full flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video size={20} className="text-muted-foreground" />
                <h2 className="text-base font-semibold text-foreground">CLIPS ({clips.length})</h2>
              </div>
              <ChunkedVideoUploader onComplete={handleClipUpload}>
                <Add size={16} />
                ADD CLIP
              </ChunkedVideoUploader>
            </div>
          </div>
          
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-4 h-full">
              {clips.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center">
                  <div>
                    <Video size={32} className="mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground text-sm">No clips added yet</p>
                  </div>
                </div>
              ) : (
                clips.map((clip, index) => (
                  <div 
                    key={clip.id} 
                    className="w-48 flex-shrink-0 bg-muted/20 rounded border border-border overflow-hidden"
                    data-testid={`clip-card-${clip.id}`}
                  >
                    <div className="h-24 bg-black flex items-center justify-center">
                      <Video size={24} className="text-gray-400" />
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-foreground truncate">{clip.title}</h4>
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: clipColors[index % clipColors.length] }}
                        ></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="text-muted-foreground">Start</label>
                          <div className="text-foreground">{formatTime(clip.startTime)}</div>
                        </div>
                        <div>
                          <label className="text-muted-foreground">End</label>
                          <div className="text-foreground">{formatTime(clip.endTime)}</div>
                        </div>
                      </div>
                      <div className="flex gap-1 mt-2">
                        <CarbonButton 
                          kind="ghost" 
                          size="sm" 
                          className="flex-1"
                          onClick={() => setSelectedClip(clip)}
                          data-testid={`button-preview-${clip.id}`}
                        >
                          PREVIEW
                        </CarbonButton>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}