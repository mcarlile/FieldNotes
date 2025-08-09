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
  date: z.string().min(1, "Date is required"),
  distance: z.number().optional(),
  elevationGain: z.number().optional(),
});

type FieldNoteFormData = z.infer<typeof fieldNoteFormSchema>;

export default function AdminPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const isEditing = !!id;
  
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [gpxContent, setGpxContent] = useState<string>("");
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
      date: "",
      distance: undefined,
      elevationGain: undefined,
    },
  });

  // Populate form with existing data when editing
  useEffect(() => {
    if (existingFieldNote && isEditing) {
      form.reset({
        title: existingFieldNote.title,
        description: existingFieldNote.description,
        tripType: existingFieldNote.tripType,
        date: new Date(existingFieldNote.date).toISOString().split('T')[0],
        distance: existingFieldNote.distance || undefined,
        elevationGain: existingFieldNote.elevationGain || undefined,
      });

      // Set GPX data if available
      if (existingFieldNote.gpxData) {
        setGpxContent(""); // We don't need to recreate the file content for editing
      }
    }
  }, [existingFieldNote, isEditing, form]);

  const saveFieldNoteMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData & { gpxData?: any, date: Date }) => {
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
      setUploadedPhotos([]);
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      
      // Navigate to the field note detail page
      const fieldNoteId = isEditing ? id : result.id;
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
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "text/xml");
      
      // Check for XML parsing errors
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        throw new Error("Invalid XML format");
      }
      
      // Extract track points from various GPX formats
      const trackPoints = xmlDoc.querySelectorAll("trkpt, rtept, wpt");
      const coordinates: [number, number][] = [];
      
      trackPoints.forEach(point => {
        const lat = parseFloat(point.getAttribute("lat") || "0");
        const lon = parseFloat(point.getAttribute("lon") || "0");
        if (!isNaN(lat) && !isNaN(lon)) {
          coordinates.push([lon, lat]); // GeoJSON format: [longitude, latitude]
        }
      });

      if (coordinates.length > 0) {
        const fileSize = (content.length / 1024).toFixed(1);
        toast({ 
          title: "GPX Parsed Successfully", 
          description: `Found ${coordinates.length} points from ${fileSize}KB file` 
        });
      } else {
        toast({ 
          title: "Warning", 
          description: "No track points found in GPX file",
          variant: "destructive" 
        });
      }
    } catch (error) {
      toast({ 
        title: "Error", 
        description: `Failed to parse GPX file: ${error.message}`,
        variant: "destructive" 
      });
    }
  };

  const onSubmit = (data: FieldNoteFormData) => {
    let gpxData = null;
    let gpxStats = null;
    
    if (gpxContent) {
      try {
        // Parse GPX data to extract coordinates, distance, and elevation gain
        gpxStats = parseGpxData(gpxContent);
        gpxData = { coordinates: gpxStats.coordinates };
        
        // Show parsing results
        toast({ 
          title: "GPX Analysis Complete", 
          description: `Distance: ${gpxStats.distance} miles, Elevation: ${gpxStats.elevationGain} ft`,
          variant: "default" 
        });
      } catch (error) {
        toast({ 
          title: "GPX Parse Error", 
          description: error.message || "Failed to parse GPX data",
          variant: "destructive" 
        });
        return;
      }
    }

    // Merge form data with parsed GPX stats (auto-populate if not manually entered)
    const fieldNoteData = { 
      ...data, 
      date: new Date(data.date), 
      distance: data.distance || gpxStats?.distance,
      elevationGain: data.elevationGain || gpxStats?.elevationGain,
      gpxData 
    };

    // Save field note (create or update)
    saveFieldNoteMutation.mutate(fieldNoteData, {
      onSuccess: (savedFieldNote) => {
        // Create photo records for uploaded photos (only for new uploads)
        if (uploadedPhotos.length > 0) {
          uploadedPhotos.forEach(async (photo) => {
            try {
              await apiRequest("/api/photos", "POST", {
                fieldNoteId: savedFieldNote.id,
                filename: photo.filename,
                url: photo.url,
                // TODO: Add EXIF data extraction if needed
              });
            } catch (error) {
              console.error("Error creating photo record:", error);
            }
          });
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

                <div className="grid grid-cols-2 gap-4">
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

                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input 
                            type="datetime-local" 
                            data-testid="input-date"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="distance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Distance (miles)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.1"
                            placeholder="Auto-populated from GPX"
                            data-testid="input-distance"
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            value={field.value || ""} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="elevationGain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Elevation Gain (feet)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="Auto-populated from GPX"
                            data-testid="input-elevation"
                            onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                            value={field.value || ""} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                      Distance and elevation gain will be automatically calculated from GPX data
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