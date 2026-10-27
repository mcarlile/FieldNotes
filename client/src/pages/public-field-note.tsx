import { useState, lazy, Suspense } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Mountain } from "lucide-react";
import PhotoLightbox from "@/components/photo-lightbox";
import TripDetails from "@/components/trip-details";
import type { StudioClip } from "@/components/trip-view";
import type { ElevationPoint } from "@shared/gpx-utils";
import { apiRequest } from "@/lib/queryClient";
import type { FieldNote, Photo } from "@shared/schema";

// The trip view carries the map and video player, so it loads on its own.
const TripView = lazy(() => import("@/components/trip-view"));

interface PublicFieldNote extends FieldNote {
  photos: Photo[];
  videoClips?: StudioClip[];
}

/**
 * A trip opened from a view-only share link. Laid out exactly like the trip
 * page, without the owner's controls (share, edit, delete, adding media).
 */
export default function PublicFieldNotePage() {
  const { slug } = useParams<{ slug: string }>();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [hoveredElevationPoint, setHoveredElevationPoint] = useState<ElevationPoint | null>(null);

  const { data: note, isLoading, error } = useQuery<PublicFieldNote>({
    queryKey: ["/api/public/field-notes", slug],
    queryFn: () => apiRequest(`/api/public/field-notes/${slug}`, "GET").then(r => r.json()),
    enabled: !!slug,
    retry: false,
  });

  if (isLoading) {
    return <div className="w-full h-[calc(100vh-2.75rem)] bg-muted animate-pulse" />;
  }

  if (error || !note) {
    return (
      <div className="min-h-[calc(100vh-2.75rem)] bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Mountain size={40} className="text-muted-foreground" />
        <p className="font-serif text-xl text-foreground">This trip isn't available</p>
        <p className="text-sm text-muted-foreground">Sharing may have been turned off, or the link is incorrect.</p>
      </div>
    );
  }

  const videoClips = note.videoClips ?? [];

  return (
    <div className="bg-background">
      <Suspense fallback={<div className="w-full h-[calc(100vh-2.75rem)] bg-muted animate-pulse" />}>
        <TripView
          trip={note}
          photos={note.photos}
          clips={videoClips}
          onOpenPhoto={setSelectedPhotoId}
          info={<TripDetails trip={note} onHoverElevation={setHoveredElevationPoint} />}
          hoveredElevationPoint={hoveredElevationPoint}
          canEdit={false}
          backHref={null}
          initial3D
          initialTab={videoClips.length > 0 ? "videos" : "photos"}
        />
      </Suspense>

      {selectedPhotoId && (
        <PhotoLightbox
          photoId={selectedPhotoId}
          photos={note.photos}
          onClose={() => setSelectedPhotoId(null)}
          onPhotoChange={setSelectedPhotoId}
        />
      )}
    </div>
  );
}
