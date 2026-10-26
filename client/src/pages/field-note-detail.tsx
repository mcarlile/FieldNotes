import { useState, useMemo, lazy, Suspense, type ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Modal } from "@carbon/react";
import { Pencil, Trash2, ExternalLink, Download } from "lucide-react";
import ShareButton from "@/components/share-button";
import PhotoLightbox from "@/components/photo-lightbox";
import ElevationProfile from "@/components/elevation-profile";
import { parseGpxData, parseGpxWithTimestamps } from "@shared/gpx-utils";
import { buildGpxExport, downloadGpx, gpxFilename } from "@/lib/gpx-export";

import { useToast } from "@/hooks/use-toast";
import { useDesignPreview } from "@/hooks/use-design-preview";
import { useAuth } from "@clerk/react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { FieldNote, Photo, VideoClip } from "@shared/schema";

// The trip view carries the map and video player, so it loads on its own.
const TripView = lazy(() => import("@/components/trip-view"));

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dd className="text-foreground font-medium leading-tight">{value}</dd>
      <dt className="meta-mono text-muted-foreground">{label}</dt>
    </div>
  );
}

export default function FieldNoteDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hoveredElevationPoint, setHoveredElevationPoint] = useState<any>(null);

  const { toast } = useToast();
  const { isSignedIn } = useAuth();
  const { data: readOnlyPreview } = useDesignPreview();

  const { data: fieldNoteData, isLoading: isLoadingFieldNote } = useQuery({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await apiRequest(`/api/field-notes/${id}`, "GET");
      return response.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const fieldNote = fieldNoteData;
  const photos: Photo[] = fieldNoteData?.photos || [];
  const videoClips: VideoClip[] = fieldNoteData?.videoClips || [];
  const canEdit = !!isSignedIn && !readOnlyPreview;

  const handleDownloadGpx = () => {
    if (!fieldNote) return;
    const gpx = buildGpxExport(fieldNote.gpxData, fieldNote.title, fieldNote.date);
    if (!gpx) {
      toast({ title: "No GPX track", description: "This field note has no route data to export.", variant: "destructive" });
      return;
    }
    downloadGpx(gpx, gpxFilename(fieldNote.title));
    trackEvent("gpx_downloaded");
  };

  const parsedGpxData = useMemo(() => {
    if (!fieldNote?.gpxData) return null;
    try {
      if (typeof fieldNote.gpxData === "string") {
        return parseGpxData(fieldNote.gpxData);
      } else if (typeof fieldNote.gpxData === "object") {
        const data = fieldNote.gpxData as any;
        if (data.coordinates && Array.isArray(data.coordinates)) {
          return {
            coordinates: data.coordinates,
            elevationProfile: data.elevationProfile || [],
            distance: fieldNote.distance || 0,
            elevationGain: fieldNote.elevationGain || 0,
          };
        }
      }
    } catch (error) {
      console.error("Failed to parse GPX data for elevation profile:", error);
    }
    return null;
  }, [fieldNote?.gpxData, fieldNote?.distance, fieldNote?.elevationGain]);

  // Derived trip stats from elevation profile + (optional) raw GPX timestamps
  const derivedStats = useMemo(() => {
    const profile = parsedGpxData?.elevationProfile;
    if (!profile || profile.length === 0) return null;

    const elevations = profile
      .map((p: { elevation: number }) => p.elevation)
      .filter((e: number) => Number.isFinite(e));
    if (elevations.length === 0) return null;

    const maxEle = Math.round(Math.max(...elevations));
    const minEle = Math.round(Math.min(...elevations));

    // Peak grade: max % grade between adjacent points (over a smoothing window)
    let peakGrade = 0;
    const window = Math.max(1, Math.floor(profile.length / 200));
    for (let i = window; i < profile.length; i++) {
      const dEle = profile[i].elevation - profile[i - window].elevation; // ft
      const dDist = (profile[i].distance - profile[i - window].distance) * 5280; // mi → ft
      if (dDist > 0) {
        const grade = Math.abs(dEle / dDist) * 100;
        if (grade > peakGrade && grade < 100) peakGrade = grade;
      }
    }

    // Elapsed time: total timestamp span (start → end), only available when raw GPX is present
    let elapsedTime: string | null = null;
    if (typeof fieldNote?.gpxData === "string") {
      try {
        const tracked = parseGpxWithTimestamps(fieldNote.gpxData);
        if (tracked.durationSeconds > 0) {
          const total = Math.round(tracked.durationSeconds);
          const h = Math.floor(total / 3600);
          const m = Math.floor((total % 3600) / 60);
          elapsedTime = h > 0 ? `${h}h ${m}m` : `${m}m`;
        }
      } catch (_) { /* ignore */ }
    }

    return { maxEle, minEle, peakGrade: Math.round(peakGrade * 10) / 10, elapsedTime };
  }, [parsedGpxData, fieldNote?.gpxData]);

  const deleteFieldNoteMutation = useMutation({
    mutationFn: async () => apiRequest(`/api/field-notes/${id}`, "DELETE"),
    onSuccess: () => {
      trackEvent("field_note_deleted");
      toast({ title: "Success", description: "Field note deleted successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      setLocation("/dashboard");
    },
    onError: (error) => {
      toast({
        title: "Delete Error",
        description: error.message || "Failed to delete field note",
        variant: "destructive",
      });
    },
  });

  if (isLoadingFieldNote) {
    return (
      <div className="min-h-screen bg-background">
        <div className="w-full h-[60vh] bg-muted animate-pulse" />
        <div className="px-5 sm:px-8 py-8 space-y-3">
          <div className="h-10 w-2/3 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!fieldNote) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <h1 className="font-serif text-3xl text-foreground mb-3">Field Note Not Found</h1>
          <p className="text-muted-foreground mb-6">The requested field note could not be found.</p>
          <Link
            href="/dashboard"
            className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70"
          >
            Return home &rarr;
          </Link>
        </div>
      </div>
    );
  }

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  // The trip card's body; the card itself (back button, name, folding) is TripView's.
  const info = (
    <div className="space-y-4">
      <div className="meta-mono text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
        {fieldNote.tripType?.length > 0 && (
          <>
            <span>{Array.isArray(fieldNote.tripType) ? fieldNote.tripType.join(', ') : fieldNote.tripType}</span>
            <span>·</span>
          </>
        )}
        <span>{formatDate(fieldNote.date.toString())}</span>
      </div>

      {(fieldNote.distance != null || fieldNote.elevationGain != null || derivedStats) && (
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3" data-testid="trip-stats">
          {fieldNote.distance != null && <Stat label="Miles" value={fieldNote.distance} />}
          {fieldNote.elevationGain != null && <Stat label="Ft gain" value={fieldNote.elevationGain.toLocaleString()} />}
          {derivedStats && <Stat label="Ft max" value={derivedStats.maxEle.toLocaleString()} />}
          {derivedStats && <Stat label="Ft min" value={derivedStats.minEle.toLocaleString()} />}
          {derivedStats && derivedStats.peakGrade > 0 && <Stat label="Peak grade" value={`${derivedStats.peakGrade}%`} />}
          {derivedStats?.elapsedTime && <Stat label="Elapsed" value={derivedStats.elapsedTime} />}
        </dl>
      )}

      {parsedGpxData && parsedGpxData.elevationProfile && parsedGpxData.elevationProfile.length > 0 && (
        <div>
          <div className="meta-mono text-muted-foreground mb-1">Elevation</div>
          <ElevationProfile
            elevationProfile={parsedGpxData.elevationProfile}
            onHoverPoint={setHoveredElevationPoint}
            chartClassName="h-36"
            className="w-full -ml-2"
          />
        </div>
      )}

      {fieldNote.description && (
        <p className="font-serif text-foreground leading-relaxed whitespace-pre-line">{fieldNote.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-border">
        {fieldNote.stravaId && (
          <a
            href={`https://www.strava.com/${fieldNote.stravaSource === "strava-route" ? "routes" : "activities"}/${fieldNote.stravaId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="meta-mono text-orange-500 hover:text-orange-600 transition-colors flex items-center gap-1.5 pt-2"
          >
            <ExternalLink className="h-3 w-3" />
            Strava
          </a>
        )}
        {fieldNote.gpxData && (
          <button
            onClick={handleDownloadGpx}
            className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 pt-2"
            data-testid="button-download-gpx"
          >
            <Download className="h-3 w-3" />
            GPX
          </button>
        )}
        {canEdit && (
          <>
            <div className="pt-2">
              <ShareButton
                id={fieldNote.id}
                title={fieldNote.title}
                isPublished={fieldNote.isPublished ?? false}
                slug={fieldNote.slug ?? null}
                queryKey={["/api/field-notes", id]}
              />
            </div>
            <Link
              href={`/field-notes/${fieldNote.id}/edit`}
              className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 pt-2"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Link>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="meta-mono text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1.5 pt-2"
              data-testid="button-delete"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="bg-background">
      <Suspense fallback={<div className="w-full h-[calc(100vh-2.75rem)] bg-muted animate-pulse" />}>
        <TripView
          trip={fieldNote as FieldNote}
          photos={photos}
          onOpenPhoto={setSelectedPhotoId}
          info={info}
          hoveredElevationPoint={hoveredElevationPoint}
          canEdit={canEdit}
          initialTab={videoClips.length > 0 ? "videos" : "photos"}
        />
      </Suspense>

      <Modal
        open={showDeleteModal}
        onRequestClose={() => setShowDeleteModal(false)}
        modalHeading="Delete Field Note"
        primaryButtonText="Delete"
        danger
        secondaryButtonText="Cancel"
        onRequestSubmit={() => {
          deleteFieldNoteMutation.mutate();
          setShowDeleteModal(false);
        }}
      >
        <p>Are you sure you want to delete "{fieldNote.title}"? This action cannot be undone.</p>
      </Modal>

      {selectedPhotoId && (
        <PhotoLightbox
          photoId={selectedPhotoId}
          photos={photos}
          onClose={() => setSelectedPhotoId(null)}
          onPhotoChange={setSelectedPhotoId}
        />
      )}
    </div>
  );
}
