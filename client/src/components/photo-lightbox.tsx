import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Photo } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

interface PhotoLightboxProps {
  photoId: string;
  photos: Photo[];
  onClose: () => void;
  onPhotoChange: (photoId: string) => void;
}

export default function PhotoLightbox({ photoId, photos, onClose, onPhotoChange }: PhotoLightboxProps) {
  const imageRef = useRef<HTMLImageElement>(null);
    const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const { data: photo, isLoading } = useQuery<Photo>({
    queryKey: ["/api/photos", photoId],
    queryFn: async () => {
      const response = await apiRequest(`/api/photos/${photoId}`, "GET");
      return response.json();
    },
  });

  // Find current photo index and navigation info
  const currentIndex = photos.findIndex(p => p.id === photoId);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;
  const photoNumber = currentIndex + 1;

  // Navigation functions
  const goToPrevious = () => {
    if (hasPrevious && !isAnimating) {
      setIsAnimating(true);
      onPhotoChange(photos[currentIndex - 1].id);
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  const goToNext = () => {
    if (hasNext && !isAnimating) {
      setIsAnimating(true);
      onPhotoChange(photos[currentIndex + 1].id);
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPrevious();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToNext();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, hasPrevious, hasNext, onClose]);

  // Touch/swipe navigation for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const swipeThreshold = 50;
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > swipeThreshold) {
      // Swipe left goes to the next photo, swipe right to the previous one
      if (diff > 0) goToNext();
      else goToPrevious();
    }
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "Unknown";
    return new Date(timestamp).toLocaleString();
  };

  const formatCoordinates = (lat: number | null, lng: number | null) => {
    if (lat == null || lng == null) return "Unknown";
    return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  };

  const modalHeading = (
    <div className="flex items-center justify-between w-full pr-8">
      <div className="flex items-baseline gap-4 min-w-0">
        <DialogTitle className="text-lg font-medium truncate">
          {photo?.filename || "Loading..."}
        </DialogTitle>
        <DialogDescription className="shrink-0">
          Photo {photoNumber} of {photos.length}
        </DialogDescription>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={goToPrevious}
          disabled={!hasPrevious || isAnimating}
          className="p-2 rounded-md hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid="photo-nav-previous"
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={goToNext}
          disabled={!hasNext || isAnimating}
          className="p-2 rounded-md hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid="photo-nav-next"
          aria-label="Next photo"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-5xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto"
        aria-label="Photo details and metadata"
      >
      <DialogHeader>{modalHeading}</DialogHeader>
      <div
        className="select-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-pulse">
              <div className="w-full h-96 bg-muted mb-4 rounded"></div>
              <div className="h-4 bg-muted mb-2 rounded"></div>
              <div className="h-4 bg-muted w-2/3 mx-auto rounded"></div>
            </div>
          </div>
        ) : !photo ? (
          <div className="p-8 text-center text-muted-foreground">
            Photo not found
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Photo Display (2/3) */}
            <div className="lg:col-span-2 relative">
              {/* Navigation arrows overlay for large screens */}
              <div className="hidden lg:block">
                {hasPrevious && (
                  <button
                    onClick={goToPrevious}
                    className="absolute left-4 top-1/2 transform -translate-y-1/2 z-10 p-3 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full transition-all duration-200"
                    data-testid="photo-overlay-previous"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                )}
                {hasNext && (
                  <button
                    onClick={goToNext}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10 p-3 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full transition-all duration-200"
                    data-testid="photo-overlay-next"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                )}
              </div>

              {/* Photo with smooth transition */}
              <div className={`transition-opacity duration-300 ${isAnimating ? 'opacity-50' : 'opacity-100'}`}>
                <img
                  ref={imageRef}
                  src={photo.url}
                  alt={photo.filename}
                  className="w-full h-auto max-h-[60vh] object-contain"
                  data-testid="lightbox-photo"
                  onError={(e) => {
                    console.error(`Failed to load photo in lightbox: ${photo.url}`);
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.error-message')) {
                      const errorDiv = document.createElement('div');
                      errorDiv.className = 'error-message flex items-center justify-center w-full h-60 text-muted-foreground bg-muted rounded';
                      errorDiv.textContent = 'Photo file not found';
                      parent.appendChild(errorDiv);
                    }
                  }}
                />
              </div>

              {/* Mobile swipe indicator */}
              <div className="lg:hidden absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-50 text-white text-xs px-3 py-1 rounded-full">
                Swipe to navigate
              </div>
            </div>

            {/* Photo Metadata (1/3) */}
            <div className="space-y-6">
              {/* Basic Info */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-3">Photo Details</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Filename:</span>
                    <span className="ml-2 font-medium">{photo.filename}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Taken:</span>
                    <span className="ml-2">{formatTimestamp(photo.timestamp?.toString() || null)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Location:</span>
                    <span className="ml-2">{formatCoordinates(photo.latitude, photo.longitude)}</span>
                  </div>
                  {photo.elevation && (
                    <div>
                      <span className="text-muted-foreground">Elevation:</span>
                      <span className="ml-2">{Math.round((photo.elevation ?? 0) * 3.28084)} ft</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">File Size:</span>
                    <span className="ml-2">{photo.fileSize}</span>
                  </div>
                </div>
              </div>

              {/* Camera Info */}
              {photo.camera && (
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Camera Settings</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Camera:</span>
                      <span className="ml-2">{photo.camera}</span>
                    </div>
                    {photo.lens && (
                      <div>
                        <span className="text-muted-foreground">Lens:</span>
                        <span className="ml-2">{photo.lens}</span>
                      </div>
                    )}
                    {photo.aperture && (
                      <div>
                        <span className="text-muted-foreground">Aperture:</span>
                        <span className="ml-2">{photo.aperture}</span>
                      </div>
                    )}
                    {photo.shutterSpeed && (
                      <div>
                        <span className="text-muted-foreground">Shutter Speed:</span>
                        <span className="ml-2">{photo.shutterSpeed}</span>
                      </div>
                    )}
                    {photo.iso && (
                      <div>
                        <span className="text-muted-foreground">ISO:</span>
                        <span className="ml-2">{photo.iso}</span>
                      </div>
                    )}
                    {photo.focalLength && (
                      <div>
                        <span className="text-muted-foreground">Focal Length:</span>
                        <span className="ml-2">{photo.focalLength}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation Help Text */}
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="font-medium">Navigation:</div>
                <div>Desktop: Use ← → arrow keys or click arrows</div>
                <div>Mobile: Swipe left/right to navigate</div>
                <div>Press Escape to close</div>
              </div>
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}