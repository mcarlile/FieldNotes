import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Grid,
  Column,
  Breadcrumb,
  BreadcrumbItem,
  Loading,
  InlineNotification,
} from "@carbon/react";
import { ArrowLeft } from "@carbon/icons-react";
import MapboxMap from "@/components/mapbox-map";
import PhotoLightbox from "@/components/photo-lightbox";
import type { FieldNote, Photo } from "@shared/schema";
import { useState } from "react";

export default function RouteDetails() {
  const { id } = useParams();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // Fetch field note data
  const { data: fieldNoteData, isLoading, error } = useQuery({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    gcTime: 10 * 60 * 1000, // 10 minutes in cache
  });

  const fieldNote = fieldNoteData;
  const photos = fieldNoteData?.photos || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200">
          <Grid fullWidth>
            <Column sm={4} md={8} lg={16} className="py-4">
              <div className="flex items-center justify-center py-12">
                <Loading />
              </div>
            </Column>
          </Grid>
        </div>
      </div>
    );
  }

  if (error || !fieldNote) {
    return (
      <div className="min-h-screen bg-gray-50">
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
                  Route Details
                </BreadcrumbItem>
              </Breadcrumb>
            </Column>
          </Grid>
        </div>
        <div className="py-6">
          <Grid fullWidth>
            <Column sm={4} md={8} lg={16} className="flex items-center justify-center">
              <InlineNotification
                kind="error"
                title="Error"
                subtitle="Failed to load route details"
                hideCloseButton
              />
            </Column>
          </Grid>
        </div>
      </div>
    );
  }

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
              <BreadcrumbItem>
                <Link href={`/field-notes/${fieldNote.id}`} className="text-blue-600 hover:text-blue-800">
                  {fieldNote.title}
                </Link>
              </BreadcrumbItem>
              <BreadcrumbItem isCurrentPage>
                Route Details
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
            <div className="flex items-center gap-4 mb-6">
              <Link href={`/field-notes/${fieldNote.id}`}>
                <button className="flex items-center gap-2 text-blue-600 hover:text-blue-800 transition-colors">
                  <ArrowLeft size={20} />
                  <span>Back to Details</span>
                </button>
              </Link>
              <div className="h-6 border-l border-gray-300"></div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Route Details: {fieldNote.title}
              </h1>
            </div>

            {/* Full-screen Interactive Map */}
            <div className="w-full h-[calc(100vh-12rem)] bg-white rounded-lg shadow-sm overflow-hidden">
              <MapboxMap
                gpxData={fieldNote.gpxData}
                photos={photos}
                onPhotoClick={setSelectedPhotoId}
                className="w-full h-full"
              />
            </div>
          </Column>
        </Grid>
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