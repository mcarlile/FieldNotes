import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, useLocation, Link } from "wouter";
import { Loader2, Trash2 } from "lucide-react";
import type { UploadResult } from "@uppy/core";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AutoPhotoUploader } from "@/components/auto-photo-uploader";
import type { FieldNote } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";
import { type PhotoExifData } from "@/lib/exif-extractor";

const fieldNoteFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
});

type FieldNoteFormData = z.infer<typeof fieldNoteFormSchema>;

const tripTypeOptions = [
  { id: "hiking", text: "Hiking" },
  { id: "cycling", text: "Cycling" },
  { id: "running", text: "Running" },
  { id: "backpacking", text: "Backpacking" },
  { id: "paddling", text: "Paddling" },
  { id: "fishing", text: "Fishing" },
  { id: "motorcycle", text: "Motorcycle" },
  { id: "climbing", text: "Climbing" },
  { id: "skiing", text: "Skiing" },
  { id: "other", text: "Other" },
];

export default function AdminPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
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
    id?: string;
    exifData?: PhotoExifData;
  }>>([]);
  const [selectedTripTypes, setSelectedTripTypes] = useState<string[]>(["hiking"]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FieldNoteFormData>({
    resolver: zodResolver(fieldNoteFormSchema),
    defaultValues: { title: "", description: "" },
  });

  const { data: existingFieldNote, isLoading: isLoadingFieldNote } = useQuery<FieldNote>({
    queryKey: ["/api/field-notes", id],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}`);
      if (!response.ok) throw new Error("Failed to fetch field note");
      return response.json();
    },
    enabled: isEditing,
  });

  const { data: existingPhotos = [] } = useQuery({
    queryKey: ["/api/field-notes", id, "photos"],
    queryFn: async () => {
      const response = await fetch(`/api/field-notes/${id}/photos`);
      if (!response.ok) throw new Error("Failed to fetch photos");
      return response.json();
    },
    enabled: isEditing,
  });

  const handleGpxFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".gpx")) {
      toast({ title: "Invalid file", description: "Please select a .gpx file", variant: "destructive" });
      return;
    }

    setGpxFile(file);
    const reader = new FileReader();
    reader.onerror = () => toast({ title: "File read error", description: "Unable to read the GPX file.", variant: "destructive" });
    reader.onload = (e) => {
      try {
        const content = e.target?.result;
        if (typeof content !== "string" || !content.trim()) throw new Error("File appears to be empty");
        setGpxContent(content);
        const parsed = parseGpxData(content);
        setGpxStats(parsed);

        if (parsed.date) {
          const currentValues = form.getValues();
          if (!currentValues.title) {
            form.setValue("title", `Field Note - ${parsed.date.toLocaleDateString()}`);
          }
        }

        toast({ title: "GPX loaded", description: `${parsed.coordinates.length} points`, variant: "success" });
      } catch (error) {
        setGpxContent("");
        setGpxStats(null);
        setGpxFile(null);
        toast({
          title: "GPX parse error",
          description: error instanceof Error ? error.message : "Unable to parse GPX file.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const handlePhotoUpload = async () => {
    const response = await fetch("/api/photos/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get upload URL: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return { method: "PUT" as const, url: data.uploadURL };
  };

  const handlePhotoUploadComplete = (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
    exifDataArray?: (PhotoExifData | null)[],
  ) => {
    if (result.successful && result.successful.length > 0) {
      const normalize = (url: string) => {
        if (!url.startsWith("https://storage.googleapis.com/")) return url;
        const pathname = new URL(url).pathname;
        const bucketMatch = pathname.match(/^\/([^/]+)\/(.*)$/);
        if (!bucketMatch) return url;
        const [, , objectPath] = bucketMatch;
        if (objectPath.startsWith(".private/uploads/")) {
          return `/objects/uploads/${objectPath.replace(".private/uploads/", "")}`;
        }
        return url;
      };

      const newPhotos = result.successful.map((upload, index) => ({
        url: normalize((upload as { uploadURL: string }).uploadURL),
        filename: upload.name ?? "photo",
        caption: "",
        exifData: exifDataArray?.[index],
      }));
      setUploadedPhotos((prev) => [...prev, ...newPhotos]);

      const photosWithGps = newPhotos.filter((p) => p.exifData?.latitude && p.exifData?.longitude);
      toast({
        title: "Upload complete",
        description: `${result.successful.length} photo(s) uploaded${photosWithGps.length > 0 ? ` · ${photosWithGps.length} with GPS` : ""}`,
      });
    } else if (result.failed && result.failed.length > 0) {
      toast({ title: "Upload failed", description: `${result.failed.length} photo(s) failed`, variant: "destructive" });
    }
  };

  const updatePhotoCaption = (index: number, caption: string) =>
    setUploadedPhotos((prev) => prev.map((p, i) => (i === index ? { ...p, caption } : p)));

  const removePhoto = (index: number) =>
    setUploadedPhotos((prev) => prev.filter((_, i) => i !== index));

  const buildPhotoPayload = () =>
    uploadedPhotos.map((photo) => ({
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
    }));

  const createMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData) =>
      apiRequest("/api/field-notes", "POST", {
        ...data,
        tripType: selectedTripTypes,
        gpxData: gpxContent,
        distance: gpxStats?.distance || null,
        elevationGain: gpxStats?.elevationGain || null,
        date: gpxStats?.date || new Date(),
        photos: buildPhotoPayload(),
      }),
    onSuccess: () => {
      toast({ title: "Field note created", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      setLocation("/dashboard");
    },
    onError: (error) =>
      toast({ title: "Create error", description: error.message || "Failed to create field note", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FieldNoteFormData) =>
      apiRequest(`/api/field-notes/${id}`, "PUT", {
        ...data,
        tripType: selectedTripTypes,
        gpxData: gpxContent || existingFieldNote?.gpxData,
        distance: gpxStats?.distance || existingFieldNote?.distance,
        elevationGain: gpxStats?.elevationGain || existingFieldNote?.elevationGain,
        date: gpxStats?.date || existingFieldNote?.date,
        photos: buildPhotoPayload(),
      }),
    onSuccess: () => {
      toast({ title: "Field note updated", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/field-notes", id, "photos"] });
      setLocation(`/field-notes/${id}`);
    },
    onError: (error) =>
      toast({ title: "Update error", description: error.message || "Failed to update field note", variant: "destructive" }),
  });

  const onSubmit = (data: FieldNoteFormData) => {
    if (selectedTripTypes.length === 0) {
      toast({ title: "Trip type required", description: "Select at least one trip type", variant: "destructive" });
      return;
    }
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      if (!gpxContent) {
        toast({ title: "GPX required", description: "Please upload a GPX file", variant: "destructive" });
        return;
      }
      createMutation.mutate(data);
    }
  };

  useEffect(() => {
    if (existingFieldNote) {
      form.reset({
        title: existingFieldNote.title,
        description: existingFieldNote.description,
      });
      setSelectedTripTypes(Array.isArray(existingFieldNote.tripType) ? existingFieldNote.tripType : [existingFieldNote.tripType]);
      setGpxContent(existingFieldNote.gpxData as string);
    }
  }, [existingFieldNote, form]);

  useEffect(() => {
    if (isEditing && existingPhotos && existingPhotos.length > 0) {
      const formattedPhotos = (existingPhotos as Array<{
        id: string;
        url: string;
        filename: string;
        altText?: string | null;
        description?: string | null;
      }>).map((photo) => ({
        url: photo.url,
        filename: photo.filename,
        caption: photo.altText || photo.description || "",
        id: photo.id,
      }));
      setUploadedPhotos(formattedPhotos);
    } else if (!isEditing) {
      setUploadedPhotos([]);
    }
  }, [existingPhotos, isEditing, id]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isLoadingFieldNote) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <main className="px-5 sm:px-8 pt-6 pb-16 max-w-3xl mx-auto">
        {/* Page header */}
        <div className="mb-10">
          <div className="meta-mono text-muted-foreground mb-3">
            {isEditing ? "Edit · field note" : "New · field note"}
          </div>
          <h1
            className="font-serif text-foreground"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, letterSpacing: "-0.015em" }}
          >
            {isEditing ? "Edit field note" : "Add a new trip"}
          </h1>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
          {/* Title */}
          <div>
            <label htmlFor="title" className="meta-mono text-muted-foreground block mb-2">
              Title
            </label>
            <input
              id="title"
              type="text"
              placeholder="Name your trip…"
              value={form.watch("title")}
              onChange={(e) => form.setValue("title", e.target.value)}
              className="w-full bg-transparent border-b border-border focus:border-foreground outline-none py-2 font-serif text-2xl text-foreground placeholder:text-muted-foreground/60 transition-colors"
              data-testid="input-title"
            />
            {form.formState.errors.title && (
              <p className="meta-mono text-destructive mt-2">{form.formState.errors.title.message}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="meta-mono text-muted-foreground block mb-2">
              Description
            </label>
            <textarea
              id="description"
              placeholder="Tell the story of this adventure…"
              rows={5}
              value={form.watch("description")}
              onChange={(e) => form.setValue("description", e.target.value)}
              className="w-full bg-transparent border-b border-border focus:border-foreground outline-none py-2 font-serif text-lg leading-relaxed text-foreground placeholder:text-muted-foreground/60 transition-colors resize-y"
              data-testid="textarea-description"
            />
            {form.formState.errors.description && (
              <p className="meta-mono text-destructive mt-2">{form.formState.errors.description.message}</p>
            )}
          </div>

          {/* Trip type — pill row */}
          <div>
            <label className="meta-mono text-muted-foreground block mb-3">Trip type</label>
            <div className="flex flex-wrap gap-2">
              {tripTypeOptions.map((opt) => {
                const active = selectedTripTypes.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSelectedTripTypes((prev) =>
                        prev.includes(opt.id) ? prev.filter((t) => t !== opt.id) : [...prev, opt.id]
                      );
                    }}
                    className={`meta-mono px-3 py-1.5 rounded-full border transition-colors ${
                      active
                        ? "border-foreground text-foreground bg-muted"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    }`}
                    data-testid={`pill-trip-type-${opt.id}`}
                  >
                    {opt.text}
                  </button>
                );
              })}
            </div>
          </div>

          {/* GPX upload */}
          <div>
            <label className="meta-mono text-muted-foreground block mb-3">
              GPX track {!isEditing && <span className="text-destructive">*</span>}
            </label>

            <label
              htmlFor="gpx-file"
              className="meta-mono inline-flex items-center px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors cursor-pointer"
            >
              {gpxFile ? "Replace .gpx" : "Choose .gpx file"}
            </label>
            <input
              id="gpx-file"
              type="file"
              accept=".gpx,application/gpx+xml,text/xml"
              onChange={handleGpxFileChange}
              className="sr-only"
              data-testid="input-gpx-file"
            />
            {gpxFile && (
              <span className="meta-mono text-muted-foreground ml-3 break-all">{gpxFile.name}</span>
            )}

            {gpxStats && (
              <div className="mt-4 pt-4 border-t border-border meta-mono text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>{gpxStats.distance.toFixed(1)} mi</span>
                <span>·</span>
                <span>{gpxStats.elevationGain.toFixed(0)} ft gain</span>
                {gpxStats.date && (
                  <>
                    <span>·</span>
                    <span>{gpxStats.date.toLocaleDateString()}</span>
                  </>
                )}
                <span>·</span>
                <span>{gpxStats.coordinates.length} pts</span>
              </div>
            )}
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="meta-mono text-muted-foreground">
                Photos {uploadedPhotos.length > 0 && `· ${uploadedPhotos.length}`}
              </label>
              <AutoPhotoUploader
                maxNumberOfFiles={10}
                maxFileSize={52428800}
                onGetUploadParameters={handlePhotoUpload}
                onComplete={handlePhotoUploadComplete}
                buttonClassName="meta-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              >
                <span>+ Upload</span>
              </AutoPhotoUploader>
            </div>

            {uploadedPhotos.length > 0 && (
              <div className="border-t border-border divide-y divide-border">
                {uploadedPhotos.map((photo, index) => (
                  <div key={index} className="py-4 flex gap-4 items-start">
                    <div className="w-16 h-16 flex-shrink-0 bg-muted overflow-hidden">
                      <img src={photo.url} alt={`Upload ${index + 1}`} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-grow min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-foreground text-sm truncate">{photo.filename}</div>
                          <div className="meta-mono text-muted-foreground mt-0.5">
                            {photo.id ? "Existing" : "New"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
                          className="meta-mono text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 flex-shrink-0"
                          data-testid={`button-remove-photo-${index}`}
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                      <input
                        type="text"
                        placeholder="Caption…"
                        value={photo.caption}
                        onChange={(e) => updatePhotoCaption(index, e.target.value)}
                        className="w-full bg-transparent border-b border-border focus:border-foreground outline-none py-1 text-sm text-foreground placeholder:text-muted-foreground/60 transition-colors"
                        data-testid={`input-caption-${index}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-border flex items-center gap-6">
            <button
              type="submit"
              disabled={isPending}
              className="meta-mono text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity disabled:opacity-50 flex items-center gap-2"
              data-testid="button-submit"
            >
              {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {isEditing ? "Save changes →" : "Create field note →"}
            </button>
            <Link
              href={isEditing ? `/field-notes/${id}` : "/"}
              className="meta-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
