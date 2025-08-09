import { useQuery } from "@tanstack/react-query";
import { Modal } from "@carbon/react";
import { Close } from "@carbon/icons-react";
import type { Photo } from "@shared/schema";

interface PhotoLightboxProps {
  photoId: string;
  onClose: () => void;
}

export default function PhotoLightbox({ photoId, onClose }: PhotoLightboxProps) {
  const { data: photo, isLoading } = useQuery<Photo>({
    queryKey: ["/api/photos", photoId],
    queryFn: async () => {
      const response = await fetch(`/api/photos/${photoId}`);
      if (!response.ok) throw new Error("Failed to fetch photo");
      return response.json();
    },
  });

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "Unknown";
    return new Date(timestamp).toLocaleString();
  };

  const formatCoordinates = (lat: number | null, lng: number | null) => {
    if (!lat || !lng) return "Unknown";
    return `${lat.toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${lng.toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  };

  return (
    <Modal
      open={true}
      onRequestClose={onClose}
      size="lg"
      modalHeading={photo?.filename || "Loading..."}
      primaryButtonText="Close"
      onRequestSubmit={onClose}
      hasScrollingContent
      aria-label="Photo details and metadata"
    >
      {isLoading ? (
        <div className="p-8 text-center">
          <div className="animate-pulse">
            <div className="w-full h-96 bg-gray-20 mb-4"></div>
            <div className="h-4 bg-gray-20 mb-2"></div>
            <div className="h-4 bg-gray-20 w-2/3 mx-auto"></div>
          </div>
        </div>
      ) : !photo ? (
        <div className="p-8 text-center text-text-secondary">
          Photo not found
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Photo Display (2/3) */}
          <div className="lg:col-span-2">
            <img
              src={photo.url}
              alt={photo.filename}
              className="w-full h-auto max-h-[60vh] object-contain"
              onError={(e) => {
                console.error(`Failed to load photo in lightbox: ${photo.url}`);
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.error-message')) {
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'error-message flex items-center justify-center w-full h-60 text-gray-500 bg-gray-100';
                  errorDiv.textContent = 'Photo file not found';
                  parent.appendChild(errorDiv);
                }
              }}
            />
          </div>

          {/* Photo Metadata (1/3) */}
          <div className="lg:col-span-1 p-4 bg-layer-01">
            <h4 className="text-heading-03 mb-4 text-text-primary">Photo Details</h4>
            <div className="space-y-3 text-body-compact-01">
              <div>
                <span className="font-semibold text-text-primary">Filename:</span>
                <span className="block text-text-secondary font-mono text-xs break-all">
                  {photo.filename}
                </span>
              </div>
              
              <div>
                <span className="font-semibold text-text-primary">Timestamp:</span>
                <span className="block text-text-secondary">
                  {formatTimestamp(photo.timestamp?.toString() || null)}
                </span>
              </div>
              
              <div>
                <span className="font-semibold text-text-primary">Location:</span>
                <span className="block text-text-secondary font-mono text-xs">
                  {formatCoordinates(photo.latitude, photo.longitude)}
                </span>
              </div>
              
              {photo.elevation && (
                <div>
                  <span className="font-semibold text-text-primary">Elevation:</span>
                  <span className="block text-text-secondary">{photo.elevation}m</span>
                </div>
              )}
              
              {photo.camera && (
                <div>
                  <span className="font-semibold text-text-primary">Camera:</span>
                  <span className="block text-text-secondary">{photo.camera}</span>
                </div>
              )}
              
              {photo.lens && (
                <div>
                  <span className="font-semibold text-text-primary">Lens:</span>
                  <span className="block text-text-secondary">{photo.lens}</span>
                </div>
              )}
              
              {(photo.aperture || photo.shutterSpeed || photo.iso) && (
                <div>
                  <span className="font-semibold text-text-primary">Settings:</span>
                  <span className="block text-text-secondary font-mono text-xs">
                    {[photo.aperture, photo.shutterSpeed, photo.iso && `ISO ${photo.iso}`]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              )}
              
              {photo.focalLength && (
                <div>
                  <span className="font-semibold text-text-primary">Focal Length:</span>
                  <span className="block text-text-secondary">{photo.focalLength}</span>
                </div>
              )}
              
              {photo.fileSize && (
                <div>
                  <span className="font-semibold text-text-primary">File Size:</span>
                  <span className="block text-text-secondary">{photo.fileSize}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
