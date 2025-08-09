import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import MapboxMap from "@/components/mapbox-map";
import PhotoLightbox from "@/components/photo-lightbox";
import { useState } from "react";
import { Edit, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { FieldNote, Photo } from "@shared/schema";

export default function FieldNoteDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: fieldNote, isLoading: isLoadingFieldNote } = useQuery<FieldNote>({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: !!id,
  });

  const { data: photos = [], isLoading: isLoadingPhotos } = useQuery<Photo[]>({
    queryKey: ["/api/field-notes", id, "photos"],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}/photos`);
      if (!response.ok) throw new Error("Failed to fetch photos");
      return response.json();
    },
    enabled: !!id,
  });

  const deleteFieldNoteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/field-notes/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Field note deleted successfully!",
        className: "bg-green-50 border-green-200 text-green-900"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      setLocation("/");
    },
    onError: (error) => {
      toast({
        title: "Delete Error", 
        description: error.message || "Failed to delete field note",
        variant: "destructive"
      });
    },
  });

  if (isLoadingFieldNote) {
    return (
      <div className="min-h-screen bg-carbon-gray-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="animate-pulse">
            <div className="h-8 bg-carbon-gray-20 mb-4 w-1/3"></div>
            <div className="h-16 bg-carbon-gray-20 mb-6"></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 h-96 bg-carbon-gray-20"></div>
              <div className="h-96 bg-carbon-gray-20"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!fieldNote) {
    return (
      <div className="min-h-screen bg-carbon-gray-10 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-carbon-gray-100 mb-4 font-ibm">Field Note Not Found</h1>
          <p className="text-carbon-gray-70 mb-6 font-ibm">The requested field note could not be found.</p>
          <Link href="/" className="text-carbon-blue hover:underline font-ibm">
            Return to Home
          </Link>
        </div>
      </div>
    );
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-carbon-gray-10">
      {/* Breadcrumb */}
      <nav className="bg-white border-b border-carbon-gray-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/" className="text-carbon-blue hover:underline font-ibm">Home</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="text-carbon-gray-100 font-ibm">{fieldNote.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </nav>

      {/* Detail Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex justify-between items-start mb-4">
            <h1 className="text-3xl font-semibold text-carbon-gray-100 font-ibm">{fieldNote.title}</h1>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="gap-2">
                <Link href={`/admin/${fieldNote.id}`}>
                  <Edit className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="gap-2" data-testid="button-delete">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Field Note</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{fieldNote.title}"? This action cannot be undone and will also delete all associated photos.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteFieldNoteMutation.mutate()}
                      disabled={deleteFieldNoteMutation.isPending}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {deleteFieldNoteMutation.isPending ? "Deleting..." : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <p className="text-carbon-gray-70 mb-4 font-ibm">{fieldNote.description}</p>
          <div className="flex flex-wrap gap-6 text-sm text-carbon-gray-70 font-ibm">
            <span><strong>Trip Type:</strong> {fieldNote.tripType}</span>
            <span><strong>Date:</strong> {formatDate(fieldNote.date.toString())}</span>
            {fieldNote.distance && <span><strong>Distance:</strong> {fieldNote.distance} miles</span>}
            {fieldNote.elevationGain && <span><strong>Elevation Gain:</strong> {fieldNote.elevationGain} ft</span>}
            <span><strong>Photos:</strong> {photos.length}</span>
          </div>
        </div>

        {/* Map and Photos Layout (2/3 - 1/3) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map Section (2/3) */}
          <div className="lg:col-span-2">
            <div className="bg-white border border-carbon-gray-20 p-4">
              <h2 className="text-lg font-medium mb-4 text-carbon-gray-100 font-ibm">GPX Track & Photo Locations</h2>
              <MapboxMap
                gpxData={fieldNote.gpxData as any}
                photos={photos}
                onPhotoClick={setSelectedPhotoId}
              />
              <div className="mt-4 text-sm text-carbon-gray-70 font-ibm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-1 bg-carbon-blue"></div>
                    <span>GPX Track</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-carbon-blue border-2 border-white rounded-full"></div>
                    <span>Photo Locations</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Photo Thumbnails (1/3) */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-carbon-gray-20 p-4">
              <h2 className="text-lg font-medium mb-4 text-carbon-gray-100 font-ibm">Photos ({photos.length})</h2>
              {isLoadingPhotos ? (
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="w-full aspect-square bg-carbon-gray-20 animate-pulse"></div>
                  ))}
                </div>
              ) : photos.length === 0 ? (
                <div className="text-center text-carbon-gray-70 py-8 font-ibm">
                  No photos available for this field note.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                  {photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt={photo.filename}
                      className="w-full aspect-square object-cover cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setSelectedPhotoId(photo.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Photo Lightbox */}
      {selectedPhotoId && (
        <PhotoLightbox
          photoId={selectedPhotoId}
          onClose={() => setSelectedPhotoId(null)}
        />
      )}
    </div>
  );
}
