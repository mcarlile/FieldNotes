import { useState, useRef, useCallback } from "react";
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
import { Upload, Pause, Play, Close } from "@carbon/icons-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const MAX_FILE_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB

interface ChunkUploadState {
  file: File;
  status: 'preparing' | 'uploading' | 'paused' | 'complete' | 'error';
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  errorMessage?: string;
  url?: string;
  uploadKey?: string;
  currentChunk?: number;
  totalChunks?: number;
}

const clipFormSchema = z.object({
  title: z.string().min(1, "Clip title is required"),
  startTime: z.number().min(0, "Start time must be 0 or greater"),
  endTime: z.number().min(0, "End time must be 0 or greater"),
  color: z.string().default("#3b82f6"),
});

type ClipFormData = z.infer<typeof clipFormSchema>;

interface ChunkedVideoUploaderProps {
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

export function ChunkedVideoUploader({
  onComplete,
  buttonClassName,
  children,
}: ChunkedVideoUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [uploadState, setUploadState] = useState<ChunkUploadState | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isPausedRef = useRef(false);

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

  const getVideoMetadata = useCallback((videoFile: File): Promise<{
    duration: number;
    format: string;
  }> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const url = URL.createObjectURL(videoFile);
      
      video.onloadedmetadata = () => {
        const duration = video.duration;
        const format = videoFile.type.split('/')[1]?.toUpperCase() || 'MP4';
        URL.revokeObjectURL(url);
        resolve({ duration, format });
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load video metadata'));
      };
      
      video.src = url;
    });
  }, []);

  const uploadChunk = async (
    chunk: Blob, 
    chunkIndex: number, 
    uploadKey: string,
    totalChunks: number,
    signal: AbortSignal,
    retries: number = 3
  ): Promise<void> => {
    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('totalChunks', String(totalChunks));
    formData.append('uploadKey', uploadKey);

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch('/api/video/upload-chunk', {
          method: 'POST',
          body: formData,
          signal,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Upload failed' }));
          throw new Error(error.message || 'Failed to upload chunk');
        }
        
        return; // Success
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error; // Don't retry aborted requests
        }
        
        lastError = error as Error;
        
        if (attempt < retries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error('Failed to upload chunk after retries');
  };

  const completeUpload = async (uploadKey: string, filename: string, contentType: string): Promise<string> => {
    const response = await fetch('/api/video/complete-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadKey, filename, contentType }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to complete upload' }));
      throw new Error(error.message || 'Failed to complete upload');
    }

    const result = await response.json();
    return result.url;
  };

  const uploadFile = async (file: File) => {
    const uploadKey = `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    abortControllerRef.current = new AbortController();
    isPausedRef.current = false;

    setUploadState({
      file,
      status: 'uploading',
      progress: 0,
      uploadedBytes: 0,
      totalBytes: file.size,
      uploadKey,
      currentChunk: 0,
      totalChunks,
    });

    try {
      for (let i = 0; i < totalChunks; i++) {
        if (isPausedRef.current) {
          setUploadState(prev => prev ? { ...prev, status: 'paused', currentChunk: i } : null);
          return;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        await uploadChunk(chunk, i, uploadKey, totalChunks, abortControllerRef.current.signal);

        const uploadedBytes = end;
        const progress = Math.round((uploadedBytes / file.size) * 100);
        
        setUploadState(prev => prev ? {
          ...prev,
          progress,
          uploadedBytes,
          currentChunk: i + 1,
        } : null);
      }

      const url = await completeUpload(uploadKey, file.name, file.type);

      setUploadState(prev => prev ? {
        ...prev,
        status: 'complete',
        progress: 100,
        url,
      } : null);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      
      setUploadState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Upload failed',
      } : null);
    }
  };

  const handleFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const videoFile = files[0];
    
    if (!videoFile.type.startsWith('video/')) {
      setUploadState({
        file: videoFile,
        status: 'error',
        progress: 0,
        uploadedBytes: 0,
        totalBytes: videoFile.size,
        errorMessage: 'Please select a video file',
      });
      return;
    }

    if (videoFile.size > MAX_FILE_SIZE) {
      setUploadState({
        file: videoFile,
        status: 'error',
        progress: 0,
        uploadedBytes: 0,
        totalBytes: videoFile.size,
        errorMessage: `File size exceeds 1.5GB limit`,
      });
      return;
    }

    setUploadState({
      file: videoFile,
      status: 'preparing',
      progress: 0,
      uploadedBytes: 0,
      totalBytes: videoFile.size,
    });

    try {
      const { duration } = await getVideoMetadata(videoFile);
      setVideoDuration(duration);
      setValue('endTime', Math.round(duration));
      setValue('title', videoFile.name.replace(/\.[^/.]+$/, ""));

      await uploadFile(videoFile);
    } catch (error) {
      setUploadState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to process video',
      } : null);
    }
  };

  const handlePauseResume = () => {
    if (!uploadState) return;

    if (uploadState.status === 'uploading') {
      isPausedRef.current = true;
      abortControllerRef.current?.abort();
    } else if (uploadState.status === 'paused' && uploadState.currentChunk !== undefined) {
      resumeUpload();
    }
  };

  const getUploadStatus = async (uploadKey: string): Promise<{ receivedChunks: number[] } | null> => {
    try {
      const response = await fetch(`/api/video/upload/${uploadKey}/status`);
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  };

  const resumeUpload = async () => {
    if (!uploadState || !uploadState.uploadKey) return;

    const file = uploadState.file;
    const totalChunks = uploadState.totalChunks || Math.ceil(file.size / CHUNK_SIZE);
    
    // Get which chunks have already been uploaded
    const status = await getUploadStatus(uploadState.uploadKey);
    const uploadedChunks = new Set(status?.receivedChunks || []);
    
    abortControllerRef.current = new AbortController();
    isPausedRef.current = false;

    setUploadState(prev => prev ? { ...prev, status: 'uploading' } : null);

    try {
      for (let i = 0; i < totalChunks; i++) {
        if (isPausedRef.current) {
          setUploadState(prev => prev ? { ...prev, status: 'paused', currentChunk: i } : null);
          return;
        }

        // Skip already uploaded chunks
        if (uploadedChunks.has(i)) {
          continue;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        await uploadChunk(chunk, i, uploadState.uploadKey!, totalChunks, abortControllerRef.current.signal);
        uploadedChunks.add(i);

        const uploadedBytes = Math.min((uploadedChunks.size / totalChunks) * file.size, file.size);
        const progress = Math.round((uploadedChunks.size / totalChunks) * 100);
        
        setUploadState(prev => prev ? {
          ...prev,
          progress,
          uploadedBytes,
          currentChunk: uploadedChunks.size,
        } : null);
      }

      const url = await completeUpload(uploadState.uploadKey, file.name, file.type);

      setUploadState(prev => prev ? {
        ...prev,
        status: 'complete',
        progress: 100,
        url,
      } : null);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      
      setUploadState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Upload failed',
      } : null);
    }
  };

  const handleFileRemove = () => {
    abortControllerRef.current?.abort();
    setUploadState(null);
    setVideoDuration(null);
    reset();
  };

  const onSubmit = (data: ClipFormData) => {
    if (!uploadState || uploadState.status !== 'complete' || !uploadState.url) {
      return;
    }

    if (data.endTime <= data.startTime) {
      return;
    }

    const duration = data.endTime - data.startTime;
    const fileSize = formatFileSize(uploadState.totalBytes);
    const videoFormat = uploadState.file.type.split('/')[1]?.toUpperCase() || 'MP4';

    if (onComplete) {
      onComplete({
        title: data.title,
        filename: uploadState.file.name,
        url: uploadState.url,
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
    abortControllerRef.current?.abort();
    setUploadState(null);
    setVideoDuration(null);
    reset();
    setShowModal(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getStatusText = () => {
    if (!uploadState) return '';
    
    switch (uploadState.status) {
      case 'preparing':
        return 'Preparing video...';
      case 'uploading':
        return `Uploading... ${formatFileSize(uploadState.uploadedBytes)} / ${formatFileSize(uploadState.totalBytes)}`;
      case 'paused':
        return `Paused - ${formatFileSize(uploadState.uploadedBytes)} / ${formatFileSize(uploadState.totalBytes)}`;
      case 'complete':
        return 'Upload complete!';
      case 'error':
        return uploadState.errorMessage || 'Upload failed';
      default:
        return '';
    }
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
        primaryButtonText={uploadState?.status === 'complete' ? "Add Clip" : "Cancel"}
        secondaryButtonText={uploadState?.status === 'complete' ? "Upload Another" : undefined}
        onRequestSubmit={uploadState?.status === 'complete' ? handleSubmit(onSubmit) : resetAndClose}
        onSecondarySubmit={uploadState?.status === 'complete' ? handleFileRemove : undefined}
        primaryButtonDisabled={uploadState?.status !== 'complete'}
        size="lg"
        data-testid="modal-video-upload"
      >
        <div className="space-y-6">
          {!uploadState && (
            <FormGroup legendText="Video File">
              <FileUploaderDropContainer
                accept={['video/*']}
                labelText="Drag and drop your video file here or click to browse"
                onAddFiles={(_, { addedFiles }) => {
                  if (addedFiles.length > 0) {
                    const mockEvent = {
                      target: { files: addedFiles } as unknown
                    } as React.ChangeEvent<HTMLInputElement>;
                    handleFileAdd(mockEvent);
                  }
                }}
                data-testid="drop-container-video"
              />
              <div className="text-sm text-muted-foreground mt-2">
                <p>Supported formats: MP4, WebM, MOV, AVI</p>
                <p>Maximum file size: 1.5GB</p>
                <p className="mt-1 text-xs">Large files are uploaded in chunks with resume capability</p>
              </div>
            </FormGroup>
          )}

          {uploadState && (
            <div className="space-y-4">
              <FileUploaderItem
                name={uploadState.file.name}
                status={uploadState.status === 'error' ? 'edit' : 'complete'}
                onDelete={uploadState.status !== 'uploading' ? handleFileRemove : undefined}
                data-testid={`file-item-${uploadState.file.name}`}
              />

              {(uploadState.status === 'preparing' || uploadState.status === 'uploading' || uploadState.status === 'paused') && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{getStatusText()}</span>
                    {(uploadState.status === 'uploading' || uploadState.status === 'paused') && (
                      <CarbonButton
                        kind="ghost"
                        size="sm"
                        renderIcon={uploadState.status === 'uploading' ? Pause : Play}
                        onClick={handlePauseResume}
                        data-testid="button-pause-resume"
                      >
                        {uploadState.status === 'uploading' ? 'Pause' : 'Resume'}
                      </CarbonButton>
                    )}
                  </div>
                  <ProgressBar 
                    value={uploadState.progress} 
                    max={100}
                    label={`Uploading: ${uploadState.progress}%`}
                    data-testid="progress-video-upload"
                  />
                  {uploadState.currentChunk !== undefined && uploadState.totalChunks && (
                    <div className="text-xs text-muted-foreground">
                      Chunk {uploadState.currentChunk} of {uploadState.totalChunks}
                    </div>
                  )}
                </div>
              )}

              {uploadState.status === 'error' && uploadState.errorMessage && (
                <InlineNotification
                  kind="error"
                  title="Upload Error"
                  subtitle={uploadState.errorMessage}
                  hideCloseButton
                  data-testid="notification-video-error"
                />
              )}

              {uploadState.status === 'complete' && videoDuration && (
                <InlineNotification
                  kind="success"
                  title="Video Uploaded Successfully"
                  subtitle={`Duration: ${formatTime(videoDuration)}, Size: ${formatFileSize(uploadState.totalBytes)}`}
                  hideCloseButton
                  data-testid="notification-video-success"
                />
              )}
            </div>
          )}

          {uploadState?.status === 'complete' && (
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
