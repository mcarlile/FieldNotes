import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Plus, Image, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { FieldNote } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";

const fieldNoteFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  tripType: z.string().min(1, "Trip type is required"),
});

type FieldNoteFormData = z.infer<typeof fieldNoteFormSchema>;

export default function AdminPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
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
  }>>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing field note data for editing
  const { data: existingFieldNote } = useQuery<FieldNote>({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: isEditing,
  });

  const form = useForm<FieldNoteFormData>({
    resolver: zodResolver(fieldNoteFormSchema),
    defaultValues: {
      title: "",
      description: "",
      tripType: "",
    },
  });

  // Populate form with existing data when editing
  useEffect(() => {
    if (existingFieldNote && isEditing) {
      form.reset({
        title: existingFieldNote.title,
        description: existingFieldNote.description,
        tripType: existingFieldNote.tripType,
      });

      // Set GPX stats if available
      if (existingFieldNote.gpxData && typeof existingFieldNote.gpxData === 'object' && 'coordinates' in existingFieldNote.gpxData) {
        setGpxStats({
          distance: existingFieldNote.distance || 0,
          elevationGain: existingFieldNote.elevationGain || 0,
          date: existingFieldNote.date ? new Date(existingFieldNote.date) : null,
          coordinates: (existingFieldNote.gpxData.coordinates as [number, number][]) || []
        });
      }
    }
  }, [existingFieldNote, isEditing, form]);

  const saveFieldNoteMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData & { gpxData?: any, date: Date, distance?: number, elevationGain?: number }) => {
      if (isEditing) {
        return apiRequest(`/api/field-notes/${id}`, "PUT", data);
      } else {
        return apiRequest("/api/field-notes", "POST", data);
      }
    },
    onSuccess: (result) => {
      const successMessage = isEditing ? "Field note updated" : "Field note created";
      const toastDescription = isEditing ? "Field note updated successfully!" : "Field note created successfully!";
      
      toast({ 
        title: "Success", 
        description: toastDescription,
        className: "bg-green-50 border-green-200 text-green-900" 
      });
      
      form.reset();
      setGpxFile(null);
      setGpxContent("");
      setGpxStats(null);
      setUploadedPhotos([]);
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      
      // Navigate to the field note detail page
      const fieldNoteId = isEditing ? id : (result as any).id;
      setLocation(`/field-notes/${fieldNoteId}`);
    },
    onError: (error) => {
      let errorMessage = "Failed to create field note";
      if (error.message.includes("request entity too large") || error.message.includes("413")) {
        errorMessage = "GPX file is too large. Please try a file smaller than 50MB or compress your GPX data.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({ 
        title: "Upload Error", 
        description: errorMessage,
        variant: "destructive" 
      });
    },
  });

  const handleGpxFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setGpxFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setGpxContent(content);
        parseGpxContent(content);
      };
      reader.readAsText(file);
    }
  };

  const parseGpxContent = (content: string) => {
    try {
      // Parse GPX data to extract all statistics
      const stats = parseGpxData(content);
      setGpxStats(stats);
      
      // Show parsing results with all extracted data
      const dateStr = stats.date ? stats.date.toLocaleDateString() : "No date found";
      toast({ 
        title: "GPX Analysis Complete", 
        description: `Distance: ${stats.distance} miles, Elevation: ${stats.elevationGain} ft, Date: ${dateStr}`,
        className: "bg-green-50 border-green-200 text-green-900"
      });
    } catch (error: any) {
      toast({ 
        title: "Error", 
        description: `Failed to parse GPX file: ${error.message}`,
        variant: "destructive" 
      });
      setGpxStats(null);
    }
  };

  const onSubmit = (data: FieldNoteFormData) => {
    // Validate that we have GPX data for new entries
    if (!isEditing && !gpxStats) {
      toast({ 
        title: "GPX Required", 
        description: "Please upload a GPX file to extract distance, elevation, and date information.",
        variant: "destructive" 
      });
      return;
    }

    // Use GPX stats or existing data for editing
    const fieldNoteData = { 
      ...data, 
      date: gpxStats?.date || (existingFieldNote ? new Date(existingFieldNote.date) : new Date()),
      distance: gpxStats?.distance || existingFieldNote?.distance || undefined,
      elevationGain: gpxStats?.elevationGain || existingFieldNote?.elevationGain || undefined,
      gpxData: gpxStats ? { coordinates: gpxStats.coordinates } : existingFieldNote?.gpxData
    };

    // Save field note (create or update)
    saveFieldNoteMutation.mutate(fieldNoteData, {
      onSuccess: async (savedFieldNote) => {
        // Create photo records for uploaded photos (only for new uploads)
        if (uploadedPhotos.length > 0) {
          const photoPromises = uploadedPhotos.map(async (photo) => {
            try {
              const response = await apiRequest("/api/photos", "POST", {
                fieldNoteId: (savedFieldNote as any).id,
                filename: photo.filename,
                url: photo.url,
                // TODO: Add EXIF data extraction if needed
              });
              return response;
            } catch (error) {
              console.error("Error creating photo record:", error);
              return null;
            }
          });
          
          // Wait for all photo records to be created
          await Promise.all(photoPromises);
        }
      },
    });
  };

  // Photo upload handlers
  const handlePhotoUploadParameters = async () => {
    const response = await apiRequest("/api/photos/upload", "POST");
    const data = await response.json();
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  const handlePhotoUploadComplete = (result: any) => {
    if (result.successful && result.successful.length > 0) {
      const newPhotos = result.successful.map((file: any) => ({
        url: file.uploadURL,
        filename: file.name,
      }));
      setUploadedPhotos(prev => [...prev, ...newPhotos]);
      toast({
        title: "Photos Uploaded",
        description: `${newPhotos.length} photo(s) uploaded successfully`,
      });
    }
  };

  const removePhoto = (index: number) => {
    setUploadedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {isEditing ? "Edit Field Note" : "Add New Field Note"}
            </CardTitle>
            <CardDescription>
              {isEditing 
                ? "Update your field note details and GPX track."
                : "Create a new field note with GPX track data and details"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., Mount Whitney Summit Trail" 
                          data-testid="input-title"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Describe your adventure..."
                          data-testid="input-description"
                          rows={4}
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div>
                  <FormField
                    control={form.control}
                    name="tripType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trip Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-trip-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Hiking">Hiking</SelectItem>
                            <SelectItem value="Cycling">Cycling</SelectItem>
                            <SelectItem value="Motorcycle">Motorcycle</SelectItem>
                            <SelectItem value="Running">Running</SelectItem>
                            <SelectItem value="Climbing">Climbing</SelectItem>
                            <SelectItem value="Skiing">Skiing</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* GPX Analysis Results */}
                {gpxStats && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h4 className="font-medium text-green-900 mb-2">GPX Analysis Results</h4>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-green-700 font-medium">Date:</span>
                        <p className="text-green-800">
                          {gpxStats.date ? gpxStats.date.toLocaleDateString() : "No date found"}
                        </p>
                      </div>
                      <div>
                        <span className="text-green-700 font-medium">Distance:</span>
                        <p className="text-green-800">{gpxStats.distance} miles</p>
                      </div>
                      <div>
                        <span className="text-green-700 font-medium">Elevation Gain:</span>
                        <p className="text-green-800">{gpxStats.elevationGain} ft</p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <FormLabel>GPX File</FormLabel>
                  <div className="mt-2">
                    <Input
                      type="file"
                      accept=".gpx,.xml"
                      onChange={handleGpxFileChange}
                      data-testid="input-gpx-file"
                      className="cursor-pointer"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Date, distance, and elevation gain will be automatically extracted from GPX data
                    </p>
                    {gpxFile && (
                      <div className="mt-2 space-y-1">
                        <p className="text-sm text-muted-foreground">
                          Selected: {gpxFile.name} ({(gpxFile.size / 1024).toFixed(1)}KB)
                        </p>
                        {gpxFile.size > 100 * 1024 * 1024 && (
                          <p className="text-sm text-orange-600">
                            ⚠️ Large file detected ({'>'}100MB). Upload may take longer.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Photo Upload Section */}
                <div>
                  <FormLabel>Photos</FormLabel>
                  <div className="mt-2 space-y-3">
                    <ObjectUploader
                      maxNumberOfFiles={10}
                      maxFileSize={50 * 1024 * 1024} // 50MB
                      onGetUploadParameters={handlePhotoUploadParameters}
                      onComplete={handlePhotoUploadComplete}
                      buttonClassName="w-full"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Image className="h-4 w-4" />
                        <span>Upload Photos</span>
                      </div>
                    </ObjectUploader>
                    
                    {uploadedPhotos.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Uploaded Photos ({uploadedPhotos.length})
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {uploadedPhotos.map((photo, index) => (
                            <div
                              key={index}
                              className="relative bg-carbon-gray-20 p-2 rounded border flex items-center justify-between"
                            >
                              <span className="text-sm truncate mr-2">
                                {photo.filename}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removePhoto(index)}
                                className="h-6 w-6 p-0 hover:bg-red-100"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-4">
                  <Button 
                    type="button"
                    variant="outline" 
                    className="flex-1"
                    onClick={() => setLocation(isEditing ? `/field-notes/${id}` : "/")}
                    data-testid="button-cancel"
                  >
                    {isEditing ? "Discard Changes" : "Cancel"}
                  </Button>
                  <Button 
                    type="submit" 
                    className="flex-1"
                    data-testid="button-submit"
                    disabled={saveFieldNoteMutation.isPending}
                  >
                    {saveFieldNoteMutation.isPending ? (
                      isEditing ? "Saving..." : "Creating..."
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        {isEditing ? "Save Changes" : "Create Field Note"}
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}