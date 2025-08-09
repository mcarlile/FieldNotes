import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@carbon/react";
import { ChevronLeft, ChevronRight, Close } from "@carbon/icons-react";
import type { Photo } from "@shared/schema";

interface PhotoLightboxProps {
  photoId: string;
  photos: Photo[];
  onClose: () => void;
  onPhotoChange: (photoId: string) => void;
}

export default function PhotoLightbox({ photoId, photos, onClose, onPhotoChange }: PhotoLightboxProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const { data: photo, isLoading } = useQuery<Photo>({
    queryKey: ["/api/photos", photoId],
    queryFn: async () => {
      const response = await fetch(`/api/photos/${photoId}`);
      if (!response.ok) throw new Error("Failed to fetch photo");
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
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, hasPrevious, hasNext, onClose]);

  // Touch/swipe navigation for mobile
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX.current = e.touches[0].clientX;
    };

    const handleTouchMove = (e: TouchEvent) => {
      touchEndX.current = e.touches[0].clientX;
    };

    const handleTouchEnd = () => {
      const swipeThreshold = 50;
      const diff = touchStartX.current - touchEndX.current;

      if (Math.abs(diff) > swipeThreshold) {
        if (diff > 0) {
          // Swiped left - go to next photo
          goToNext();
        } else {
          // Swiped right - go to previous photo
          goToPrevious();
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [currentIndex, hasPrevious, hasNext]);

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "Unknown";
    return new Date(timestamp).toLocaleString();
  };

  const formatCoordinates = (lat: number | null, lng: number | null) => {
    if (!lat || !lng) return "Unknown";
    return `${lat.toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${lng.toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  };

  const modalHeading = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-4">
        <span className="text-lg font-medium">
          {photo?.filename || "Loading..."}
        </span>
        <span className="text-sm text-gray-600">
          Photo {photoNumber} of {photos.length}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={goToPrevious}
          disabled={!hasPrevious || isAnimating}
          className="p-2 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid="photo-nav-previous"
          aria-label="Previous photo"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={goToNext}
          disabled={!hasNext || isAnimating}
          className="p-2 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          data-testid="photo-nav-next"
          aria-label="Next photo"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );

  // Mobile detection using a more reliable approach
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const modalProps = {
    open: true,
    onRequestClose: onClose,
    size: "lg" as const,
    modalHeading,
    hasScrollingContent: true,
    "aria-label": "Photo details and metadata",
    ...(isMobile ? {} : {
      primaryButtonText: "Close",
      onRequestSubmit: onClose
    })
  };

  return (
    <Modal {...modalProps}>
      <div ref={containerRef} className="select-none">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-pulse">
              <div className="w-full h-96 bg-gray-200 mb-4 rounded"></div>
              <div className="h-4 bg-gray-200 mb-2 rounded"></div>
              <div className="h-4 bg-gray-200 w-2/3 mx-auto rounded"></div>
            </div>
          </div>
        ) : !photo ? (
          <div className="p-8 text-center text-gray-600">
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
                    <ChevronLeft size={24} />
                  </button>
                )}
                {hasNext && (
                  <button
                    onClick={goToNext}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10 p-3 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full transition-all duration-200"
                    data-testid="photo-overlay-next"
                    aria-label="Next photo"
                  >
                    <ChevronRight size={24} />
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
                      errorDiv.className = 'error-message flex items-center justify-center w-full h-60 text-gray-500 bg-gray-100 rounded';
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
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Photo Details</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Filename:</span>
                    <span className="ml-2 font-medium">{photo.filename}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Taken:</span>
                    <span className="ml-2">{formatTimestamp(photo.timestamp?.toString() || null)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Location:</span>
                    <span className="ml-2">{formatCoordinates(photo.latitude, photo.longitude)}</span>
                  </div>
                  {photo.elevation && (
                    <div>
                      <span className="text-gray-600">Elevation:</span>
                      <span className="ml-2">{Math.round(photo.elevation)} ft</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-600">File Size:</span>
                    <span className="ml-2">{photo.fileSize}</span>
                  </div>
                </div>
              </div>

              {/* Camera Info */}
              {photo.camera && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Camera Settings</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-600">Camera:</span>
                      <span className="ml-2">{photo.camera}</span>
                    </div>
                    {photo.lens && (
                      <div>
                        <span className="text-gray-600">Lens:</span>
                        <span className="ml-2">{photo.lens}</span>
                      </div>
                    )}
                    {photo.aperture && (
                      <div>
                        <span className="text-gray-600">Aperture:</span>
                        <span className="ml-2">{photo.aperture}</span>
                      </div>
                    )}
                    {photo.shutterSpeed && (
                      <div>
                        <span className="text-gray-600">Shutter Speed:</span>
                        <span className="ml-2">{photo.shutterSpeed}</span>
                      </div>
                    )}
                    {photo.iso && (
                      <div>
                        <span className="text-gray-600">ISO:</span>
                        <span className="ml-2">{photo.iso}</span>
                      </div>
                    )}
                    {photo.focalLength && (
                      <div>
                        <span className="text-gray-600">Focal Length:</span>
                        <span className="ml-2">{photo.focalLength}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation Help Text */}
              <div className="text-xs text-gray-500 space-y-1">
                <div className="font-medium">Navigation:</div>
                <div>Desktop: Use ← → arrow keys or click arrows</div>
                <div>Mobile: Swipe left/right to navigate</div>
                <div>Press Escape to close</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}