import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [gpxContent, setGpxContent] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const createFieldNoteMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData & { gpxData?: any, date: Date }) => {
      return apiRequest("/api/field-notes", "POST", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Field note created successfully!" });
      form.reset();
      setGpxFile(null);
      setGpxContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
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
    
    if (gpxContent) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(gpxContent, "text/xml");
        
        // Check for XML parsing errors
        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
          throw new Error("Invalid GPX file format");
        }
        
        // Extract track points from various GPX elements
        const trackPoints = xmlDoc.querySelectorAll("trkpt, rtept, wpt");
        const coordinates: [number, number][] = [];
        
        trackPoints.forEach(point => {
          const lat = parseFloat(point.getAttribute("lat") || "0");
          const lon = parseFloat(point.getAttribute("lon") || "0");
          if (!isNaN(lat) && !isNaN(lon)) {
            coordinates.push([lon, lat]);
          }
        });
        
        if (coordinates.length === 0) {
          throw new Error("No valid track points found in GPX file");
        }
        
        gpxData = { coordinates };
      } catch (error) {
        toast({ 
          title: "GPX Parse Error", 
          description: error.message || "Failed to parse GPX data",
          variant: "destructive" 
        });
        return;
      }
    }

    createFieldNoteMutation.mutate({ 
      ...data, 
      date: new Date(data.date), 
      gpxData 
    });
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add New Field Note
            </CardTitle>
            <CardDescription>
              Create a new field note with GPX track data and details
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
                            placeholder="e.g., 12.5"
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
                            placeholder="e.g., 3000"
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
                    {gpxFile && (
                      <div className="mt-2 space-y-1">
                        <p className="text-sm text-muted-foreground">
                          Selected: {gpxFile.name} ({(gpxFile.size / 1024).toFixed(1)}KB)
                        </p>
                        {gpxFile.size > 10 * 1024 * 1024 && (
                          <p className="text-sm text-orange-600">
                            ⚠️ Large file detected. Upload may take longer.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full"
                  data-testid="button-submit"
                  disabled={createFieldNoteMutation.isPending}
                >
                  {createFieldNoteMutation.isPending ? (
                    "Creating..."
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Create Field Note
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}