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
import ElevationProfile from "@/components/elevation-profile";
import { parseGpxData } from "@shared/gpx-utils";
import type { FieldNote, Photo } from "@shared/schema";
import { useState, useMemo } from "react";

export default function RouteDetails() {
  const { id } = useParams();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [hoveredElevationPoint, setHoveredElevationPoint] = useState<any>(null);

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

  // Parse GPX data to get elevation profile
  const parsedGpxData = useMemo(() => {
    if (!fieldNote?.gpxData) return null;
    try {
      if (typeof fieldNote.gpxData === 'string') {
        return parseGpxData(fieldNote.gpxData);
      } else if (typeof fieldNote.gpxData === 'object' && fieldNote.gpxData.elevationProfile) {
        return fieldNote.gpxData;
      }
    } catch (error) {
      console.error('Failed to parse GPX data for elevation profile:', error);
    }
    return null;
  }, [fieldNote?.gpxData]);

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

            {/* Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Interactive Map */}
              <div className="lg:col-span-2">
                <div className="w-full h-[60vh] bg-white rounded-lg shadow-sm overflow-hidden">
                  <MapboxMap
                    gpxData={fieldNote.gpxData}
                    photos={photos}
                    onPhotoClick={setSelectedPhotoId}
                    hoveredElevationPoint={hoveredElevationPoint}
                    className="w-full h-full"
                  />
                </div>
              </div>

              {/* Elevation Profile */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-lg shadow-sm p-6">
                  {parsedGpxData && parsedGpxData.elevationProfile ? (
                    <ElevationProfile 
                      elevationProfile={parsedGpxData.elevationProfile}
                      onHoverPoint={setHoveredElevationPoint}
                      className="w-full"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-64 bg-gray-50 rounded">
                      <p className="text-gray-500">No elevation data available</p>
                    </div>
                  )}
                </div>
              </div>
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