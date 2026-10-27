import { useState, lazy, Suspense } from "react";
import { trackEvent } from "@/lib/analytics";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Modal } from "@carbon/react";
import { Pencil, Trash2 } from "lucide-react";
import ShareButton from "@/components/share-button";
import PhotoLightbox from "@/components/photo-lightbox";
import TripDetails from "@/components/trip-details";

import { useToast } from "@/hooks/use-toast";
import { useDesignPreview } from "@/hooks/use-design-preview";
import { useAuth } from "@clerk/react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { FieldNote, Photo, VideoClip } from "@shared/schema";

// The trip view carries the map and video player, so it loads on its own.
const TripView = lazy(() => import("@/components/trip-view"));

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

  // The trip card's body; the card itself (back button, name, folding) is TripView's.
  const info = (
    <TripDetails
      trip={fieldNote as FieldNote}
      onHoverElevation={setHoveredElevationPoint}
      actions={canEdit && (
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
    />
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
          initial3D
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
