import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Modal } from "@carbon/react";
import { Pencil, Trash2 } from "lucide-react";
import PhotoLightbox from "@/components/photo-lightbox";
import MapboxMap from "@/components/mapbox-map";
import ElevationProfile from "@/components/elevation-profile";
import { parseGpxData } from "@shared/gpx-utils";

import { useToast } from "@/hooks/use-toast";
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
            {photos.map((photo, index) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhotoId(photo.id)}
                className="block w-full mb-3 sm:mb-4 break-inside-avoid overflow-hidden bg-muted hover:opacity-90 transition-opacity"
                data-testid={`photo-thumbnail-${photo.id}`}
              >
                <img
                  src={photo.url}
                  alt={`Field note photo ${index + 1}`}
                  className="w-full h-auto block"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = "none";
                  }}
                />
              </button>
            ))}
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
