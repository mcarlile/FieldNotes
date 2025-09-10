import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Modal,
  TextInput,
  TextArea,
  Button as CarbonButton,
  InlineNotification,
  Tag,
  Form,
  FormGroup,
} from "@carbon/react";
import { Add, Upload } from "@carbon/icons-react";
import { GPXFileUploader } from "@/components/gpx-file-uploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { TrailcamProject, InsertTrailcamProject } from "@shared/schema";

const projectFormSchema = z.object({
  title: z.string().min(1, "Project title is required"),
  description: z.string().optional(),
});

type ProjectFormData = z.infer<typeof projectFormSchema>;

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated?: (project: TrailcamProject) => void;
}

export function NewProjectModal({
  isOpen,
  onClose,
  onProjectCreated,
}: NewProjectModalProps) {
  const [gpxData, setGpxData] = useState<{
    distance: number;
    elevationGain: number;
    date: Date | null;
    coordinates: [number, number][];
    parsedData: any;
    filename: string;
  } | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectFormSchema),
  });

  const createProjectMutation = useMutation({
    mutationFn: async (data: ProjectFormData) => {
      if (!gpxData) {
        throw new Error("GPX file is required");
      }

      const projectData: InsertTrailcamProject = {
        title: data.title,
        description: data.description || null,
        gpxData: gpxData.parsedData,
        duration: null, // Will be calculated later when video clips are added
        startTime: gpxData.date,
        endTime: null, // Will be set when project timeline is finalized
      };

      return apiRequest("/api/trailcam-projects", "POST", projectData);
    },
    onSuccess: (project: TrailcamProject) => {
      toast({
        title: "Success",
        description: `Project "${project.title}" created successfully!`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trailcam-projects"] });
      handleClose();
      onProjectCreated?.(project);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    reset();
    setGpxData(null);
    onClose();
  };

  const onSubmit = (data: ProjectFormData) => {
    createProjectMutation.mutate(data);
  };

  const handleGPXComplete = (uploadedGpxData: {
    distance: number;
    elevationGain: number;
    date: Date | null;
    coordinates: [number, number][];
    parsedData: any;
    filename: string;
  }) => {
    setGpxData(uploadedGpxData);
  };

  const formatTime = (date: Date | null) => {
    if (!date) return "Unknown";
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <Modal
      open={isOpen}
      onRequestClose={handleClose}
      modalHeading="Create New TrailCam Project"
      primaryButtonText="Create Project"
      secondaryButtonText="Cancel"
      onRequestSubmit={handleSubmit(onSubmit)}
      onSecondarySubmit={handleClose}
      primaryButtonDisabled={!gpxData || createProjectMutation.isPending}
      size="md"
      data-testid="modal-new-project"
    >
      <Form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Project Details */}
        <FormGroup legendText="Project Information" className="space-y-4">
          <TextInput
            id="title"
            labelText="Project Title *"
            placeholder="Enter a descriptive name for your project"
            invalid={!!errors.title}
            invalidText={errors.title?.message}
            data-testid="input-project-title"
            {...register("title")}
          />

          <TextArea
            id="description"
            labelText="Description (Optional)"
            placeholder="Describe your video project, route details, or any special notes"
            rows={3}
            data-testid="textarea-project-description"
            {...register("description")}
          />
        </FormGroup>

        {/* GPX File Upload */}
        <FormGroup legendText="GPS Route Data" className="space-y-4">
          <div className="text-sm text-muted-foreground mb-2">
            Upload a GPX file containing the GPS route data that your video clips will be synchronized with.
          </div>

          <GPXFileUploader onComplete={handleGPXComplete}>
            <div className="flex items-center gap-2">
              <Upload size={16} />
              <span>{gpxData ? "Change GPX File" : "Upload GPX File"}</span>
            </div>
          </GPXFileUploader>

          {gpxData && (
            <div className="mt-4 p-4 bg-muted/20 rounded border">
              <div className="flex items-center gap-2 mb-3">
                <h4 className="font-medium text-foreground">Route Information</h4>
                <Tag type="blue" size="sm">{gpxData.filename}</Tag>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Distance:</span>
                  <div className="font-medium">{gpxData.distance} km</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Elevation Gain:</span>
                  <div className="font-medium">{gpxData.elevationGain} m</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Track Points:</span>
                  <div className="font-medium">{gpxData.coordinates.length}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Recorded:</span>
                  <div className="font-medium">{formatTime(gpxData.date)}</div>
                </div>
              </div>
            </div>
          )}

          {!gpxData && (
            <InlineNotification
              kind="info"
              title="GPX File Required"
              subtitle="Please upload a GPX file to proceed. This will serve as the timeline reference for your video clips."
              hideCloseButton
              data-testid="notification-gpx-required"
            />
          )}
        </FormGroup>

        {createProjectMutation.isError && (
          <InlineNotification
            kind="error"
            title="Project Creation Failed"
            subtitle={createProjectMutation.error?.message || "An unexpected error occurred"}
            hideCloseButton
            data-testid="notification-create-error"
          />
        )}
      </Form>
    </Modal>
  );
}