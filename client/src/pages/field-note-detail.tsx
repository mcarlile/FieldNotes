import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Modal } from "@carbon/react";
import { Pencil, Trash2 } from "lucide-react";
import PhotoLightbox from "@/components/photo-lightbox";
import MapboxMap from "@/components/mapbox-map";
import ElevationProfile from "@/components/elevation-profile";
import { parseGpxData, parseGpxWithTimestamps } from "@shared/gpx-utils";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { FieldNote, Photo } from "@shared/schema";

export default function FieldNoteDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [hoveredElevationPoint, setHoveredElevationPoint] = useState<any>(null);

  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const { data: fieldNoteData, isLoading: isLoadingFieldNote } = useQuery({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const fieldNote = fieldNoteData;
  const photos: Photo[] = fieldNoteData?.photos || [];

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

    const elevations = profile.map((p) => p.elevation).filter((e) => Number.isFinite(e));
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
      toast({ title: "Success", description: "Field note deleted successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      setLocation("/");
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
            href="/"
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

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      {/* Edge-to-edge hero map */}
      <div className="w-full h-[55vh] sm:h-[65vh] bg-muted">
        <MapboxMap
          gpxData={fieldNote.gpxData}
          hoveredElevationPoint={hoveredElevationPoint}
          className="w-full h-full"
        />
      </div>

      {/* Derived trip stats — single mono caption strip below the hero map */}
      {derivedStats && (
        <div className="px-5 sm:px-8 pt-4 pb-1 border-b border-border">
          <div className="meta-mono text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
            <span><span className="text-foreground">{derivedStats.maxEle.toLocaleString()}</span> ft max</span>
            <span><span className="text-foreground">{derivedStats.minEle.toLocaleString()}</span> ft min</span>
            {derivedStats.peakGrade > 0 && (
              <span><span className="text-foreground">{derivedStats.peakGrade}%</span> peak grade</span>
            )}
            {derivedStats.elapsedTime && (
              <span><span className="text-foreground">{derivedStats.elapsedTime}</span> elapsed</span>
            )}
          </div>
        </div>
      )}

      {/* Title block */}
      <section className="px-5 sm:px-8 pt-8 pb-6 max-w-5xl">
        <div className="meta-mono text-muted-foreground mb-3 flex flex-wrap gap-x-3 gap-y-1">
          <span>{fieldNote.tripType}</span>
          <span>·</span>
          <span>{formatDate(fieldNote.date.toString())}</span>
          {fieldNote.distance != null && (
            <>
              <span>·</span>
              <span>{fieldNote.distance} mi</span>
            </>
          )}
          {fieldNote.elevationGain != null && (
            <>
              <span>·</span>
              <span>{fieldNote.elevationGain} ft</span>
            </>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
          <h1
            className="font-serif text-foreground break-words"
            style={{ fontSize: "clamp(2.25rem, 5vw, 3.75rem)", lineHeight: 1.05, letterSpacing: "-0.015em" }}
          >
            {fieldNote.title}
          </h1>

          {isAuthenticated && (
            <div className="flex items-center gap-4 flex-shrink-0">
              <Link
                href={`/field-notes/${fieldNote.id}/edit`}
                className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Link>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="meta-mono text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1.5"
                data-testid="button-delete"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          )}
        </div>

        {fieldNote.description && (
          <p className="font-serif text-foreground mt-6 max-w-2xl text-lg leading-relaxed">
            {fieldNote.description}
          </p>
        )}
      </section>

      {/* Elevation profile */}
      {parsedGpxData && parsedGpxData.elevationProfile && parsedGpxData.elevationProfile.length > 0 && (
        <section className="px-5 sm:px-8 pb-10">
          <div className="meta-mono text-muted-foreground mb-3">Elevation</div>
          <div className="border-t border-border pt-4">
            <ElevationProfile
              elevationProfile={parsedGpxData.elevationProfile}
              onHoverPoint={setHoveredElevationPoint}
              className="w-full"
            />
          </div>
        </section>
      )}

      {/* Photos masonry */}
      {photos.length > 0 && (
        <section className="px-5 sm:px-8 pb-16">
          <div className="meta-mono text-muted-foreground mb-3">
            Photos · {photos.length}
          </div>
          <div className="columns-2 md:columns-3 lg:columns-4 gap-3 sm:gap-4">
            {photos.map((photo, index) => {
              const captureDate = photo.timestamp
                ? new Date(photo.timestamp).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null;
              return (
                <button
                  key={photo.id}
                  onClick={() => setSelectedPhotoId(photo.id)}
                  className="group/photo block w-full mb-3 sm:mb-4 break-inside-avoid overflow-hidden bg-muted text-left"
                  data-testid={`photo-thumbnail-${photo.id}`}
                >
                  <div className="relative overflow-hidden">
                    <img
                      src={photo.url}
                      alt={`Field note photo ${index + 1}`}
                      className="w-full h-auto block transition-opacity group-hover/photo:opacity-90"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = "none";
                      }}
                    />
                  </div>
                  {captureDate && (
                    <div className="meta-mono text-muted-foreground pt-1.5 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 group-hover/photo:opacity-100 group-focus-within/photo:opacity-100">
                      {captureDate}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

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
