import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Grid,
  Column,
  Button,
  Breadcrumb,
  BreadcrumbItem,
  Tag,
  Tile,
  Modal,
  Loading,
  InlineNotification,
  SkeletonText,
} from "@carbon/react";
import { ArrowLeft, Edit, TrashCan, Calendar, Location, ChartLineSmooth, Time, View, Close } from "@carbon/icons-react";
import MapboxRoutePreview from "@/components/mapbox-route-preview";
import PhotoLightbox from "@/components/photo-lightbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { FieldNote, Photo } from "@shared/schema";

type FieldNoteWithPhotos = FieldNote & { photos: Photo[] };

export default function FieldNoteDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showFullMap, setShowFullMap] = useState(false);
  const { toast } = useToast();

  // Single query that fetches field note with photos included
  const { data: fieldNoteData, isLoading: isLoadingFieldNote } = useQuery({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    gcTime: 10 * 60 * 1000, // 10 minutes in cache (renamed from cacheTime in v5)
  });

  const fieldNote = fieldNoteData;
  const photos = fieldNoteData?.photos || [];

  const deleteFieldNoteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/field-notes/${id}`, "DELETE");
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Field note deleted successfully!",
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

  // Show loading state only when initially loading
  if (isLoadingFieldNote) {
    return (
      <Grid fullWidth className="min-h-screen">
        <Column sm={4} md={8} lg={16} className="py-12">
          <div className="space-y-6">
            <SkeletonText heading />
            <SkeletonText />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="w-full h-96 bg-gray-200 animate-pulse rounded"></div>
              </div>
              <div>
                <div className="w-full h-96 bg-gray-200 animate-pulse rounded"></div>
              </div>
            </div>
          </div>
        </Column>
      </Grid>
    );
  }

  if (!fieldNote) {
    return (
      <Grid fullWidth className="min-h-screen">
        <Column sm={4} md={8} lg={16} className="flex items-center justify-center py-12">
          <Tile className="text-center p-8">
            <h1 className="text-2xl font-semibold text-gray-900 mb-4">Field Note Not Found</h1>
            <p className="text-gray-600 mb-6">The requested field note could not be found.</p>
            <Link href="/">
              <Button>Return to Home</Button>
            </Link>
          </Tile>
        </Column>
      </Grid>
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
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16} className="py-4">
            <Breadcrumb>
              <BreadcrumbItem>
                <Link href="/" className="text-blue-600 hover:text-blue-800">
                  Field Notes
                </Link>
              </BreadcrumbItem>
              <BreadcrumbItem isCurrentPage>
                <span className="text-gray-900 font-medium break-words">
                  {fieldNote.title}
                </span>
              </BreadcrumbItem>
            </Breadcrumb>
          </Column>
        </Grid>
      </div>

      {/* Content */}
      <div className="py-6">
        <Grid fullWidth>
          <Column sm={4} md={8} lg={16}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-2 break-words">{fieldNote.title}</h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-gray-600 mb-4">
                  <Tag type="blue" size="sm">{fieldNote.tripType}</Tag>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <Calendar size={16} />
                    {formatDate(fieldNote.date.toString())}
                  </span>
                  {fieldNote.distance && (
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Location size={16} />
                      {fieldNote.distance} miles
                    </span>
                  )}
                  {fieldNote.elevationGain && (
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <ChartLineSmooth size={16} />
                      {fieldNote.elevationGain} ft elevation
                    </span>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link href={`/field-notes/${fieldNote.id}/edit`}>
                  <Button kind="tertiary" size="sm" renderIcon={Edit}>
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                </Link>
                
                <Button
                  kind="danger--tertiary"
                  size="sm"
                  renderIcon={TrashCan}
                  onClick={() => setShowDeleteModal(true)}
                >
                  <span className="hidden sm:inline">Delete</span>
                </Button>
              </div>
            </div>

            <p className="text-gray-700 mb-8 text-base sm:text-lg break-words">{fieldNote.description}</p>

            {/* Main Content Grid */}
            <Grid className="gap-y-6">
              <Column sm={4} md={5} lg={10} className="mb-6">
                <Tile className="p-0 overflow-hidden">
                  <div className="space-y-4">
                    <MapboxRoutePreview 
                      fieldNote={fieldNote} 
                      className="w-full h-64 sm:h-96 rounded overflow-hidden"
                    />
                    <div className="flex justify-center">
                      <Button
                        kind="primary"
                        size="sm"
                        renderIcon={View}
                        onClick={() => setShowFullMap(true)}
                        data-testid="button-view-full-map"
                      >
                        View Interactive Map
                      </Button>
                    </div>
                  </div>
                </Tile>
              </Column>

              <Column sm={4} md={3} lg={6}>
                <Tile className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Photos ({photos.length})
                  </h3>
                  
                  {isLoadingFieldNote ? (
                    <div className="grid grid-cols-2 gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="w-full h-24 bg-gray-200 animate-pulse rounded"></div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {photos.map((photo: Photo) => (
                        <button
                          key={photo.id}
                          onClick={() => setSelectedPhotoId(photo.id)}
                          className="w-full h-24 bg-gray-200 rounded overflow-hidden hover:opacity-80 transition-opacity"
                        >
                          <img
                            src={photo.url}
                            alt="Field note photo"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              console.error(`Failed to load photo: ${photo.url}`);
                              // Show a placeholder or hide the broken image
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent && !parent.querySelector('.error-message')) {
                                const errorDiv = document.createElement('div');
                                errorDiv.className = 'error-message flex items-center justify-center w-full h-full text-xs text-gray-500 bg-gray-100';
                                errorDiv.textContent = 'Image not available';
                                parent.appendChild(errorDiv);
                              }
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {photos.length === 0 && !isLoadingFieldNote && (
                    <p className="text-gray-500 text-sm">No photos available</p>
                  )}
                </Tile>
              </Column>
            </Grid>
          </Column>
        </Grid>
      </div>

      {/* Delete Confirmation Modal */}
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