import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";
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
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto p-0 bg-white">
        {/* Modal Header */}
        <DialogHeader className="flex flex-row justify-between items-center p-4 border-b border-carbon-gray-20">
          <DialogTitle className="text-lg font-medium text-carbon-gray-100 font-ibm">
            {photo?.filename || "Loading..."}
          </DialogTitle>
          <button 
            onClick={onClose}
            className="text-carbon-gray-70 hover:text-carbon-gray-100 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </DialogHeader>

        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-pulse">
              <div className="w-full h-96 bg-carbon-gray-20 mb-4"></div>
              <div className="h-4 bg-carbon-gray-20 mb-2"></div>
              <div className="h-4 bg-carbon-gray-20 w-2/3 mx-auto"></div>
            </div>
          </div>
        ) : !photo ? (
          <div className="p-8 text-center text-carbon-gray-70 font-ibm">
            Photo not found
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3">
            {/* Photo Display (2/3) */}
            <div className="lg:col-span-2 p-4">
              <img
                src={photo.url}
                alt={photo.filename}
                className="w-full h-auto max-h-[60vh] object-contain"
              />
            </div>

            {/* Photo Metadata (1/3) */}
            <div className="lg:col-span-1 p-4 bg-carbon-gray-10">
              <h4 className="font-medium mb-4 text-carbon-gray-100 font-ibm">Photo Details</h4>
              <div className="space-y-3 text-sm font-ibm">
                <div>
                  <span className="font-medium text-carbon-gray-100">Filename:</span>
                  <span className="block text-carbon-gray-70 font-mono text-xs break-all">
                    {photo.filename}
                  </span>
                </div>
                
                <div>
                  <span className="font-medium text-carbon-gray-100">Timestamp:</span>
                  <span className="block text-carbon-gray-70">
                    {formatTimestamp(photo.timestamp?.toString() || null)}
                  </span>
                </div>
                
                <div>
                  <span className="font-medium text-carbon-gray-100">Location:</span>
                  <span className="block text-carbon-gray-70 font-mono text-xs">
                    {formatCoordinates(photo.latitude, photo.longitude)}
                  </span>
                </div>
                
                {photo.elevation && (
                  <div>
                    <span className="font-medium text-carbon-gray-100">Elevation:</span>
                    <span className="block text-carbon-gray-70">{photo.elevation}m</span>
                  </div>
                )}
                
                {photo.camera && (
                  <div>
                    <span className="font-medium text-carbon-gray-100">Camera:</span>
                    <span className="block text-carbon-gray-70">{photo.camera}</span>
                  </div>
                )}
                
                {photo.lens && (
                  <div>
                    <span className="font-medium text-carbon-gray-100">Lens:</span>
                    <span className="block text-carbon-gray-70">{photo.lens}</span>
                  </div>
                )}
                
                {(photo.aperture || photo.shutterSpeed || photo.iso) && (
                  <div>
                    <span className="font-medium text-carbon-gray-100">Settings:</span>
                    <span className="block text-carbon-gray-70 font-mono text-xs">
                      {[photo.aperture, photo.shutterSpeed, photo.iso && `ISO ${photo.iso}`]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                )}
                
                {photo.focalLength && (
                  <div>
                    <span className="font-medium text-carbon-gray-100">Focal Length:</span>
                    <span className="block text-carbon-gray-70">{photo.focalLength}</span>
                  </div>
                )}
                
                {photo.fileSize && (
                  <div>
                    <span className="font-medium text-carbon-gray-100">File Size:</span>
                    <span className="block text-carbon-gray-70">{photo.fileSize}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
