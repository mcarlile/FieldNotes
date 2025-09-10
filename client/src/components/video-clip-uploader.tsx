import { useState } from "react";
import { 
  Button as CarbonButton,
  Modal,
  FileUploaderDropContainer,
  FileUploaderItem,
  ProgressBar,
  InlineNotification,
  TextInput,
  NumberInput,
  Form,
  FormGroup,
  Stack,
} from "@carbon/react";
import { Upload, Video } from "@carbon/icons-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

interface VideoUploadState {
  file: File;
  status: 'uploading' | 'complete' | 'error';
  progress: number;
  errorMessage?: string;
  url?: string;
}

const clipFormSchema = z.object({
  title: z.string().min(1, "Clip title is required"),
  startTime: z.number().min(0, "Start time must be 0 or greater"),
  endTime: z.number().min(0, "End time must be 0 or greater"),
  color: z.string().default("#3b82f6"),
});

type ClipFormData = z.infer<typeof clipFormSchema>;

interface VideoClipUploaderProps {
  maxFileSize?: number;
  onComplete?: (clipData: {
    title: string;
    filename: string;
    url: string;
    startTime: number;
    endTime: number;
    duration: number;
    color: string;
    fileSize: string;
    videoFormat: string;
  }) => void;
  buttonClassName?: string;
  children: React.ReactNode;
}

export function VideoClipUploader({
  maxFileSize = 104857600, // 100MB default for video files
  onComplete,
  buttonClassName,
  children,
}: VideoClipUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [file, setFile] = useState<VideoUploadState | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ClipFormData>({
    resolver: zodResolver(clipFormSchema),
    defaultValues: {
      startTime: 0,
      endTime: 0,
      color: "#3b82f6",
    },
  });

  const watchedStartTime = watch("startTime");
  const watchedEndTime = watch("endTime");

  const getVideoMetadata = (videoFile: File): Promise<{
    duration: number;
    format: string;
  }> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(videoFile);
      
      video.onloadedmetadata = () => {
        const duration = video.duration;
        const format = videoFile.type.split('/')[1].toUpperCase() || 'MP4';
        URL.revokeObjectURL(url);
        resolve({ duration, format });
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video metadata'));
      };
      
      video.src = url;
    });
  };

  const uploadVideoFile = async (videoFile: File): Promise<string> => {
    // Get upload URL from server
    const uploadResponse = await fetch('/api/objects/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!uploadResponse.ok) {
      throw new Error('Failed to get upload URL');
    }
    
    const { uploadURL } = await uploadResponse.json();
    
    // Upload file directly to object storage
    const uploadFileResponse = await fetch(uploadURL, {
      method: 'PUT',
      body: videoFile,
      headers: {
        'Content-Type': videoFile.type,
      },
    });
    
    if (!uploadFileResponse.ok) {
      throw new Error('Failed to upload video file');
    }
    
    // Return the URL that should be used for reading the file (not the upload URL)
    // The upload URL contains query parameters and is for writing only
    // We need to extract the base path for reading
    const url = new URL(uploadURL);
    return url.pathname;
  };

  const handleFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const videoFile = files[0];
    
    // Validate file type
    if (!videoFile.type.startsWith('video/')) {
      setFile({
        file: videoFile,
        status: 'error',
        progress: 0,
        errorMessage: 'Please select a video file',
      });
      return;
    }

    // Validate file size
    if (videoFile.size > maxFileSize) {
      setFile({
        file: videoFile,
        status: 'error',
        progress: 0,
        errorMessage: `File size exceeds ${Math.round(maxFileSize / 1024 / 1024)}MB limit`,
      });
      return;
    }

    // Start upload
    setFile({
      file: videoFile,
      status: 'uploading',
      progress: 20,
    });

    try {
      // Get video metadata
      const { duration, format } = await getVideoMetadata(videoFile);
      setVideoDuration(duration);
      
      // Set default end time to video duration
      setValue('endTime', Math.round(duration));
      setValue('title', videoFile.name.replace(/\.[^/.]+$/, "")); // Remove extension

      setFile(prev => prev ? { ...prev, progress: 50 } : null);

      // Upload video file
      const uploadUrl = await uploadVideoFile(videoFile);
      
      setFile({
        file: videoFile,
        status: 'complete',
        progress: 100,
        url: uploadUrl,
      });
    } catch (error) {
      setFile({
        file: videoFile,
        status: 'error',
        progress: 0,
        errorMessage: error instanceof Error ? error.message : 'Failed to process video file',
      });
    }
  };

  const handleFileRemove = () => {
    setFile(null);
    setVideoDuration(null);
    reset();
  };

  const onSubmit = (data: ClipFormData) => {
    if (!file || file.status !== 'complete' || !file.url) {
      return;
    }

    if (data.endTime <= data.startTime) {
      // Could show an error here
      return;
    }

    const duration = data.endTime - data.startTime;
    const fileSize = (file.file.size / (1024 * 1024)).toFixed(2) + ' MB';
    const videoFormat = file.file.type.split('/')[1].toUpperCase() || 'MP4';

    if (onComplete) {
      onComplete({
        title: data.title,
        filename: file.file.name,
        url: file.url,
        startTime: data.startTime,
        endTime: data.endTime,
        duration,
        color: data.color,
        fileSize,
        videoFormat,
      });
    }

    resetAndClose();
  };

  const resetAndClose = () => {
    setFile(null);
    setVideoDuration(null);
    reset();
    setShowModal(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <CarbonButton 
        onClick={() => setShowModal(true)} 
        className={buttonClassName}
        data-testid="button-upload-video"
      >
        {children}
      </CarbonButton>

      <Modal
        open={showModal}
        onRequestClose={resetAndClose}
        modalHeading="Upload Video Clip"
        primaryButtonText={file?.status === 'complete' ? "Add Clip" : "Cancel"}
        secondaryButtonText={file?.status === 'complete' ? "Upload Another" : undefined}
        onRequestSubmit={file?.status === 'complete' ? handleSubmit(onSubmit) : resetAndClose}
        onSecondarySubmit={file?.status === 'complete' ? () => setFile(null) : undefined}
        primaryButtonDisabled={file?.status !== 'complete'}
        size="lg"
        data-testid="modal-video-upload"
      >
        <div className="space-y-6">
          {/* File Upload Section */}
          {!file && (
            <FormGroup legendText="Video File">
              <FileUploaderDropContainer
                accept={['video/*']}
                labelText="Drag and drop your video file here or click to browse"
                onAddFiles={(_, { addedFiles }) => {
                  if (addedFiles.length > 0) {
                    const mockEvent = {
                      target: { files: addedFiles } as any
                    } as React.ChangeEvent<HTMLInputElement>;
                    handleFileAdd(mockEvent);
                  }
                }}
                data-testid="drop-container-video"
              />
              <div className="text-sm text-muted-foreground mt-2">
                <p>Supported formats: MP4, WebM, MOV, AVI</p>
                <p>Maximum file size: {Math.round(maxFileSize / 1024 / 1024)}MB</p>
              </div>
            </FormGroup>
          )}

          {file && (
            <div className="space-y-4">
              <FileUploaderItem
                name={file.file.name}
                status={file.status === 'error' ? 'edit' : 'complete'}
                onDelete={file.status !== 'uploading' ? handleFileRemove : undefined}
                data-testid={`file-item-${file.file.name}`}
              />

              {file.status === 'uploading' && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Uploading video...</div>
                  <ProgressBar 
                    value={file.progress} 
                    max={100}
                    label="Uploading video file"
                    data-testid="progress-video-upload"
                  />
                </div>
              )}

              {file.status === 'error' && file.errorMessage && (
                <InlineNotification
                  kind="error"
                  title="Upload Error"
                  subtitle={file.errorMessage}
                  hideCloseButton
                  data-testid="notification-video-error"
                />
              )}

              {file.status === 'complete' && videoDuration && (
                <InlineNotification
                  kind="success"
                  title="Video Uploaded Successfully"
                  subtitle={`Duration: ${formatTime(videoDuration)}, Size: ${(file.file.size / (1024 * 1024)).toFixed(1)}MB`}
                  hideCloseButton
                  data-testid="notification-video-success"
                />
              )}
            </div>
          )}

          {/* Clip Details Form */}
          {file?.status === 'complete' && (
            <Form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <FormGroup legendText="Clip Details">
                <Stack gap={4}>
                  <TextInput
                    id="title"
                    labelText="Clip Title *"
                    placeholder="Enter a name for this video clip"
                    invalid={!!errors.title}
                    invalidText={errors.title?.message}
                    data-testid="input-clip-title"
                    {...register("title")}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <NumberInput
                      id="startTime"
                      label="Start Time (seconds)"
                      min={0}
                      max={videoDuration || 0}
                      step={1}
                      value={watchedStartTime}
                      onChange={(e) => setValue('startTime', Number((e.target as HTMLInputElement).value))}
                      invalid={!!errors.startTime}
                      invalidText={errors.startTime?.message}
                      data-testid="input-start-time"
                    />

                    <NumberInput
                      id="endTime"
                      label="End Time (seconds)"
                      min={0}
                      max={videoDuration || 0}
                      step={1}
                      value={watchedEndTime}
                      onChange={(e) => setValue('endTime', Number((e.target as HTMLInputElement).value))}
                      invalid={!!errors.endTime || watchedEndTime <= watchedStartTime}
                      invalidText={errors.endTime?.message || (watchedEndTime <= watchedStartTime ? "End time must be after start time" : "")}
                      data-testid="input-end-time"
                    />
                  </div>

                  {videoDuration && (
                    <div className="text-sm text-muted-foreground">
                      Video Duration: {formatTime(videoDuration)} | 
                      Clip Duration: {formatTime(Math.max(0, watchedEndTime - watchedStartTime))}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Timeline Color
                    </label>
                    <input
                      type="color"
                      className="w-16 h-8 rounded border border-border"
                      data-testid="input-clip-color"
                      {...register("color")}
                    />
                  </div>
                </Stack>
              </FormGroup>
            </Form>
          )}
        </div>
      </Modal>
    </div>
  );
}