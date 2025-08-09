import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, useLocation } from "wouter";
import { Link } from "wouter";
import { 
  Grid,
  Column,
  Button as CarbonButton,
  TextInput,
  TextArea,
  Dropdown,
  FileUploader,
  Tag,
  Tile,
  InlineNotification,
  Loading,
  Breadcrumb,
  BreadcrumbItem,
  Modal,
} from "@carbon/react";
import { ArrowLeft as CarbonArrowLeft, TrashCan, Upload as CarbonUpload, Add, Image as CarbonImage, Close } from "@carbon/icons-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CarbonPhotoUploader } from "@/components/carbon-photo-uploader";
import type { FieldNote } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";
import { type PhotoExifData } from "@/lib/exif-extractor";

const fieldNoteFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  tripType: z.string().min(1, "Trip type is required"),
});

type FieldNoteFormData = z.infer<typeof fieldNoteFormSchema>;

const tripTypeOptions = [
  { id: "hiking", text: "Hiking" },
  { id: "cycling", text: "Cycling" },
  { id: "running", text: "Running" },
  { id: "backpacking", text: "Backpacking" },
  { id: "motorcycle", text: "Motorcycle" },
  { id: "climbing", text: "Climbing" },
  { id: "skiing", text: "Skiing" },
  { id: "other", text: "Other" },
];

export default function AdminPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  // Get ID from either /admin/:id or /field-notes/:id/edit routes
  const id = params.id;
  const isEditing = !!id;
  
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [gpxContent, setGpxContent] = useState<string>("");
  const [gpxStats, setGpxStats] = useState<{
    distance: number;
    elevationGain: number;
    date: Date | null;
    coordinates: [number, number][];
  } | null>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{
    url: string;
    filename: string;
    caption: string;
    id?: string; // Optional ID for existing photos
    exifData?: PhotoExifData;
  }>>([]);
  const [selectedTripType, setSelectedTripType] = useState<string>("hiking");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form setup
  const form = useForm<FieldNoteFormData>({
    resolver: zodResolver(fieldNoteFormSchema),
    defaultValues: {
      title: "",
      description: "",
      tripType: "hiking",
    },
  });

  // Fetch existing field note data for editing
  const { data: existingFieldNote, isLoading: isLoadingFieldNote } = useQuery<FieldNote>({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: isEditing,
  });

  // Fetch existing photos for editing
  const { data: existingPhotos = [] } = useQuery({
    queryKey: ["/api/field-notes", id, "photos"],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}/photos`);
      if (!response.ok) throw new Error("Failed to fetch photos");
      return response.json();
    },
    enabled: isEditing,
  });

  // GPX file handler
  const handleGpxFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.gpx')) {
      setGpxFile(file);
      
      // Read and parse GPX file
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setGpxContent(content);
        
        try {
          const parsed = parseGpxData(content);
          setGpxStats(parsed);
          
          if (parsed.date) {
            // Auto-populate form fields from GPX metadata
            const currentValues = form.getValues();
            if (!currentValues.title) {
              form.setValue('title', `Field Note - ${parsed.date.toLocaleDateString()}`);
            }
          }
        } catch (error) {
          console.error('Error parsing GPX:', error);
          toast({
            title: "GPX Parse Error",
            description: "Unable to parse GPX file. Please check the file format.",
            variant: "destructive"
          });
        }
      };
      reader.readAsText(file);
    }
  };

  // Photo upload handlers
  const handlePhotoUpload = async () => {
    try {
      console.log('Requesting upload URL...');
      const response = await fetch('/api/photos/upload', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload URL response error:', response.status, errorText);
        throw new Error(`Failed to get upload URL: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log('Upload URL received successfully');
      
      return {
        method: 'PUT' as const,
        url: data.uploadURL,
      };
    } catch (error) {
      console.error('Error getting upload URL:', error);
      toast({
        title: "Upload Error",
        description: error instanceof Error ? error.message : "Failed to prepare upload",
        variant: "destructive"
      });
      throw error;
    }
  };

  const handlePhotoUploadComplete = (result: any, exifDataArray?: PhotoExifData[]) => {
    console.log('Upload complete:', result, 'EXIF data:', exifDataArray);
    
    if (result.successful && result.successful.length > 0) {
      // Normalize the upload URLs to object storage paths for proper serving
      const objectStorageService = {
        normalizeObjectEntityPath: (url: string) => {
          if (!url.startsWith("https://storage.googleapis.com/")) {
            return url;
          }
          
          const urlObj = new URL(url);
          const pathname = urlObj.pathname;
          
          // Extract the bucket and object path
          const bucketMatch = pathname.match(/^\/([^/]+)\/(.*)$/);
          if (!bucketMatch) return url;
          
          const [, , objectPath] = bucketMatch;
          
          // Convert to our serving endpoint format
          if (objectPath.startsWith('.private/uploads/')) {
            const entityId = objectPath.replace('.private/uploads/', '');
            return `/objects/uploads/${entityId}`;
          }
          
          return url;
        }
      };
      
      const newPhotos = result.successful.map((upload: any, index: number) => ({
        url: objectStorageService.normalizeObjectEntityPath(upload.uploadURL),
        filename: upload.name,
        caption: '',
        exifData: exifDataArray?.[index],
      }));
      setUploadedPhotos(prev => [...prev, ...newPhotos]);
      
      const photosWithGps = newPhotos.filter(photo => photo.exifData?.latitude && photo.exifData?.longitude);
      
      toast({
        title: "Upload Complete",
        description: `${result.successful.length} photo(s) uploaded successfully! ${photosWithGps.length > 0 ? `${photosWithGps.length} photo(s) have GPS coordinates.` : ''}`,
      });
    } else if (result.failed && result.failed.length > 0) {
      toast({
        title: "Upload Failed",
        description: `${result.failed.length} photo(s) failed to upload`,
        variant: "destructive"
      });
    }
  };

  const updatePhotoCaption = (index: number, caption: string) => {
    setUploadedPhotos(prev => 
      prev.map((photo, i) => 
        i === index ? { ...photo, caption } : photo
      )
    );
  };

  const removePhoto = (index: number) => {
    setUploadedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  // Form submission
  const createMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData) => {
      return apiRequest("/api/field-notes", "POST", {
        ...data,
        gpxData: gpxContent,
        distance: gpxStats?.distance || null,
        elevationGain: gpxStats?.elevationGain || null,
        date: gpxStats?.date || new Date(),
        photos: uploadedPhotos.map(photo => ({
          filename: photo.filename,
          url: photo.url,
          caption: photo.caption,
          latitude: photo.exifData?.latitude,
          longitude: photo.exifData?.longitude,
          elevation: photo.exifData?.elevation,
          timestamp: photo.exifData?.timestamp,
          camera: photo.exifData?.camera,
          lens: photo.exifData?.lens,
          aperture: photo.exifData?.aperture,
          shutterSpeed: photo.exifData?.shutterSpeed,
          iso: photo.exifData?.iso,
          focalLength: photo.exifData?.focalLength,
          fileSize: photo.exifData?.fileSize,
        })),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Field note created successfully!",
        variant: "success"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      setLocation("/");
    },
    onError: (error) => {
      toast({
        title: "Create Error",
        description: error.message || "Failed to create field note",
        variant: "destructive"
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData) => {
      return apiRequest(`/api/field-notes/${id}`, "PUT", {
        ...data,
        gpxData: gpxContent || existingFieldNote?.gpxData,
        distance: gpxStats?.distance || existingFieldNote?.distance,
        elevationGain: gpxStats?.elevationGain || existingFieldNote?.elevationGain,
        date: gpxStats?.date || existingFieldNote?.date,
        photos: uploadedPhotos.map(photo => ({
          filename: photo.filename,
          url: photo.url,
          caption: photo.caption,
          latitude: photo.exifData?.latitude,
          longitude: photo.exifData?.longitude,
          elevation: photo.exifData?.elevation,
          timestamp: photo.exifData?.timestamp,
          camera: photo.exifData?.camera,
          lens: photo.exifData?.lens,
          aperture: photo.exifData?.aperture,
          shutterSpeed: photo.exifData?.shutterSpeed,
          iso: photo.exifData?.iso,
          focalLength: photo.exifData?.focalLength,
          fileSize: photo.exifData?.fileSize,
        })),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Field note updated successfully!",
        variant: "success"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes", id, "photos"] });
      setLocation(`/field-notes/${id}`);
    },
    onError: (error) => {
      toast({
        title: "Update Error",
        description: error.message || "Failed to update field note",
        variant: "destructive"
      });
    },
  });

  const onSubmit = (data: FieldNoteFormData) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      if (!gpxContent) {
        toast({
          title: "GPX Required",
          description: "Please upload a GPX file",
          variant: "destructive"
        });
        return;
      }
      createMutation.mutate(data);
    }
  };

  // Load existing data into form when editing
  useEffect(() => {
    if (existingFieldNote) {
      form.reset({
        title: existingFieldNote.title,
        description: existingFieldNote.description,
        tripType: existingFieldNote.tripType,
      });
      setSelectedTripType(existingFieldNote.tripType);
      setGpxContent(existingFieldNote.gpxData as string);
    }
  }, [existingFieldNote, form]);

  // Load existing photos when editing
  useEffect(() => {
    if (isEditing && existingPhotos && existingPhotos.length > 0) {
      const formattedPhotos = existingPhotos.map((photo: any) => ({
        url: photo.url, // Use the URL as stored in database
        filename: photo.filename,
        caption: photo.altText || photo.description || '',
        id: photo.id, // Keep track of existing photo IDs
      }));
      setUploadedPhotos(formattedPhotos);
    } else if (!isEditing) {
      // Clear photos when creating new note
      setUploadedPhotos([]);
    }
  }, [existingPhotos, isEditing, id]);

  if (isLoadingFieldNote) {
    return (
      <Grid fullWidth className="min-h-screen">
        <Column sm={4} md={8} lg={16} className="flex items-center justify-center py-12">
          <Loading />
        </Column>
      </Grid>
    );
  }

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
                  {isEditing ? "Edit Field Note" : "Add Field Note"}
                </span>
              </BreadcrumbItem>
            </Breadcrumb>
          </Column>
        </Grid>
      </div>

      {/* Content */}
      <div className="py-6">
        <Grid fullWidth>
          <Column sm={4} md={6} lg={10} xlg={8}>
            <Tile className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-semibold text-gray-900">
                  {isEditing ? "Edit Field Note" : "Create New Field Note"}
                </h1>
              </div>

              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Title */}
                <TextInput
                  id="title"
                  labelText="Title"
                  placeholder="Enter field note title"
                  value={form.watch("title")}
                  onChange={(e) => form.setValue("title", e.target.value)}
                  invalid={!!form.formState.errors.title}
                  invalidText={form.formState.errors.title?.message}
                  data-testid="input-title"
                />

                {/* Description */}
                <TextArea
                  id="description"
                  labelText="Description"
                  placeholder="Describe your adventure..."
                  value={form.watch("description")}
                  onChange={(e) => form.setValue("description", e.target.value)}
                  invalid={!!form.formState.errors.description}
                  invalidText={form.formState.errors.description?.message}
                  rows={4}
                  data-testid="textarea-description"
                />

                {/* Trip Type */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Trip Type
                  </label>
                  <Dropdown
                    id="trip-type"
                    titleText=""
                    label={tripTypeOptions.find(option => option.id === selectedTripType)?.text || "Select trip type"}
                    items={tripTypeOptions}
                    itemToString={(item) => item ? item.text : ""}
                    selectedItem={tripTypeOptions.find(option => option.id === selectedTripType)}
                    onChange={({ selectedItem }) => {
                      if (selectedItem) {
                        setSelectedTripType(selectedItem.id);
                        form.setValue("tripType", selectedItem.id);
                      }
                    }}
                    data-testid="select-trip-type"
                  />
                </div>

                {/* GPX Upload */}
                <div className="space-y-4">
                  <label className="text-sm font-medium text-gray-700">
                    GPX Track {!isEditing && <span className="text-red-500">*</span>}
                  </label>
                  
                  <input
                    type="file"
                    accept=".gpx"
                    onChange={handleGpxFileChange}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    data-testid="input-gpx-file"
                  />

                  {gpxStats && (
                    <div className="p-4 bg-green-50 rounded-md">
                      <h4 className="text-sm font-medium text-green-800 mb-2">GPX Statistics:</h4>
                      <div className="flex flex-wrap gap-2">
                        <Tag type="outline">Distance: {gpxStats.distance.toFixed(1)} miles</Tag>
                        <Tag type="outline">Elevation: {gpxStats.elevationGain.toFixed(0)} ft</Tag>
                        {gpxStats.date && (
                          <Tag type="outline">Date: {gpxStats.date.toLocaleDateString()}</Tag>
                        )}
                        <Tag type="outline">Points: {gpxStats.coordinates.length}</Tag>
                      </div>
                    </div>
                  )}
                </div>

                {/* Photo Upload */}
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-2">
                      Photos
                    </label>
                    <CarbonPhotoUploader
                      maxNumberOfFiles={10}
                      maxFileSize={52428800} // 50MB
                      onGetUploadParameters={handlePhotoUpload}
                      onComplete={handlePhotoUploadComplete}
                      buttonClassName=""
                    >
                      <span>Upload Photos</span>
                    </CarbonPhotoUploader>
                  </div>

                  {/* Uploaded photos list */}
                  {uploadedPhotos.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="text-sm font-medium text-gray-700">
                        Uploaded Photos ({uploadedPhotos.length})
                      </h4>
                      
                      <div className="space-y-4">
                        {uploadedPhotos.map((photo, index) => (
                          <Tile key={index} className="p-4">
                            <div className="flex gap-4">
                              {/* Photo thumbnail */}
                              <div className="flex-shrink-0 relative">
                                <div className="w-20 h-20 bg-gray-200 rounded overflow-hidden">
                                  <img
                                    src={photo.url}
                                    alt={`Upload ${index + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                {/* Status indicator */}
                                {photo.id ? (
                                  <Tag type="blue" size="sm" className="absolute -top-2 -right-2">
                                    Existing
                                  </Tag>
                                ) : (
                                  <Tag type="green" size="sm" className="absolute -top-2 -right-2">
                                    New
                                  </Tag>
                                )}
                              </div>
                              
                              {/* Photo details */}
                              <div className="flex-grow space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium text-gray-900">
                                      {photo.filename}
                                    </span>
                                    {photo.id && (
                                      <span className="text-xs text-gray-500">
                                        Previously uploaded
                                      </span>
                                    )}
                                  </div>
                                  <CarbonButton
                                    kind="danger--tertiary"
                                    size="sm"
                                    onClick={() => removePhoto(index)}
                                    renderIcon={TrashCan}
                                    iconDescription="Remove photo"
                                    data-testid={`button-remove-photo-${index}`}
                                  >
                                    Remove
                                  </CarbonButton>
                                </div>
                                
                                <TextInput
                                  id={`caption-${index}`}
                                  labelText="Caption"
                                  placeholder="Add a caption for this photo..."
                                  value={photo.caption}
                                  onChange={(e) => updatePhotoCaption(index, e.target.value)}
                                  data-testid={`input-caption-${index}`}
                                />
                              </div>
                            </div>
                          </Tile>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <div className="flex items-center gap-4 pt-6">
                  <CarbonButton
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-submit"
                  >
                    {(createMutation.isPending || updateMutation.isPending) && <Loading className="mr-2 h-4 w-4" />}
                    {isEditing ? "Update Field Note" : "Create Field Note"}
                  </CarbonButton>
                  
                  <Link href="/">
                    <CarbonButton kind="secondary">Cancel</CarbonButton>
                  </Link>
                </div>
              </form>
            </Tile>
          </Column>
        </Grid>
      </div>
    </div>
  );
}