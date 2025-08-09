import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Grid,
  Column,
  Button as CarbonButton,
  Breadcrumb,
  BreadcrumbItem,
  Tag,
  Tile,
  Modal,
  Loading,
  InlineNotification,
  SkeletonText,
} from "@carbon/react";
import { ArrowLeft, Edit, TrashCan, Calendar, Location, ChartLineSmooth, Time } from "@carbon/icons-react";
import MapboxMap from "@/components/mapbox-map";
import PhotoLightbox from "@/components/photo-lightbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { FieldNote, Photo } from "@shared/schema";

export default function FieldNoteDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
              <CarbonButton>Return to Home</CarbonButton>
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
    <div className="min-h-screen bg-gray-50">
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
                <span className="text-gray-900 font-medium">
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
            <div className="flex justify-between items-start mb-6">
              <div>
                <h1 className="text-3xl font-semibold text-gray-900 mb-2">{fieldNote.title}</h1>
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                  <Tag type="blue" size="sm">{fieldNote.tripType}</Tag>
                  <span className="flex items-center gap-1">
                    <Calendar size={16} />
                    {formatDate(fieldNote.date.toString())}
                  </span>
                  {fieldNote.distance && (
                    <span className="flex items-center gap-1">
                      <Location size={16} />
                      {fieldNote.distance} miles
                    </span>
                  )}
                  {fieldNote.elevationGain && (
                    <span className="flex items-center gap-1">
                      <ChartLineSmooth size={16} />
                      {fieldNote.elevationGain} ft elevation
                    </span>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Link href={`/field-notes/${fieldNote.id}/edit`}>
                  <CarbonButton kind="tertiary" size="sm" renderIcon={Edit}>
                    Edit
                  </CarbonButton>
                </Link>
                
                <CarbonButton
                  kind="danger--tertiary"
                  size="sm"
                  renderIcon={TrashCan}
                  onClick={() => setShowDeleteModal(true)}
                >
                  Delete
                </CarbonButton>
              </div>
            </div>

            <p className="text-gray-700 mb-8 text-lg">{fieldNote.description}</p>

            {/* Main Content Grid */}
            <Grid>
              <Column sm={4} md={5} lg={10} className="mb-6">
                <Tile className="p-0 overflow-hidden">
                  <MapboxMap
                    gpxData={fieldNote.gpxData}
                    photos={photos}
                    onPhotoClick={setSelectedPhotoId}
                    className="w-full h-96"
                  />
                </Tile>
              </Column>

              <Column sm={4} md={3} lg={6}>
                <Tile className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Photos ({photos.length})
                  </h3>
                  
                  {isLoadingPhotos ? (
                    <div className="grid grid-cols-2 gap-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="w-full h-24 bg-gray-200 animate-pulse rounded"></div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {photos.map((photo) => (
                        <button
                          key={photo.id}
                          onClick={() => setSelectedPhotoId(photo.id)}
                          className="w-full h-24 bg-gray-200 rounded overflow-hidden hover:opacity-80 transition-opacity"
                        >
                          <img
                            src={photo.url}
                            alt="Field note photo"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {photos.length === 0 && !isLoadingPhotos && (
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