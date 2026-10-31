import { useState, useRef } from "react";
import { CircleAlert, CircleCheck, ImageUp, Loader2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { FileDropZone } from "@/components/file-drop-zone";
import type { UploadResult } from "@uppy/core";
import { type PhotoExifData } from "@/lib/exif-extractor";
import { apiRequest } from "@/lib/queryClient";
import { countOccupiedPhotoSlots, runUploadQueue, summarizeUploadBatch } from "@/lib/upload-queue";

interface AutoPhotoUploaderProps {
  maxNumberOfFiles?: number;
  // Photos already in the editor (including successful uploads reported to onComplete).
  existingPhotoCount?: number;
  // All successful IDs ever delivered to the editor, even if removed afterwards.
  acknowledgedUploadIds?: string[];
  onPendingChange?: (pending: boolean) => void;
  maxFileSize?: number;
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (result: UploadResult<Record<string, unknown>, Record<string, unknown>>, exifData?: PhotoExifData[]) => void;
  buttonClassName?: string;
  children: React.ReactNode;
}

interface FileUploadState {
  id: string;
  file: File;
  status: 'queued' | 'processing' | 'uploading' | 'complete' | 'error';
  progress: number;
  uploadUrl?: string;
  errorMessage?: string;
  exifData?: PhotoExifData;
  statusMessage: string;
}

export function AutoPhotoUploader({
  maxNumberOfFiles = 1,
  existingPhotoCount = 0,
  acknowledgedUploadIds = [],
  onPendingChange,
  maxFileSize = 10485760, // 10MB default
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: AutoPhotoUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const filesRef = useRef<FileUploadState[]>([]);
  const nextId = useRef(0);
  const sessionId = useRef(crypto.randomUUID());
  const batchTail = useRef<Promise<void>>(Promise.resolve());
  const pendingBatches = useRef(0);
  // Keep reservations for completed uploads until the editor acknowledges them,
  // even when the user closes an individual status row first.
  const unacknowledgedCompleted = useRef(new Set<string>());
  const [notice, setNotice] = useState("");
  const notifyPending = () => onPendingChange?.(pendingBatches.current > 0);
  const updateFiles = (update: (prev: FileUploadState[]) => FileUploadState[]) => {
    filesRef.current = update(filesRef.current);
    setFiles(filesRef.current);
  };
  const updateFile = (id: string, patch: Partial<FileUploadState>) =>
    updateFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));

  const extractExifFromFile = async (file: File): Promise<PhotoExifData | null> => {
    try {
      const formData = new FormData();
      formData.append('photo', file);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const exifResponse = await apiRequest(
          "/api/photos/extract-exif", "POST", formData, { signal: controller.signal },
        );
        return await exifResponse.json();
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn('EXIF extraction timed out for file:', file.name);
      } else {
        console.error('Failed to extract EXIF data:', error);
      }
      return null;
    }
  };

  const uploadSingleFile = async (fileState: FileUploadState) => {
    const id = fileState.id;
    const upload = { id, name: fileState.file.name, size: fileState.file.size, type: fileState.file.type };
    try {
      updateFile(id, { status: 'processing', statusMessage: 'Processing image data...', progress: 20, errorMessage: undefined });

      const exifData = await extractExifFromFile(fileState.file);
      
      // Step 2: Get upload URL
      updateFile(id, { statusMessage: 'Getting upload URL...', progress: 40, exifData: exifData || undefined });

      let urlTimeout: ReturnType<typeof setTimeout> | undefined;
      const uploadParams = await Promise.race([
        onGetUploadParameters(),
        new Promise<never>((_, reject) => {
          urlTimeout = setTimeout(() => reject(new Error('Upload URL request timed out')), 15000);
        }),
      ]).finally(() => clearTimeout(urlTimeout));
      
      // Step 3: Upload file
      updateFile(id, { status: 'uploading', statusMessage: 'Uploading...', progress: 60, uploadUrl: uploadParams.url });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(60000, fileState.file.size / 1024));
      let response: Response;
      try {
        response = await fetch(uploadParams.url, {
          method: uploadParams.method,
          body: fileState.file,
          headers: { 'Content-Type': fileState.file.type },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Step 4: Complete
      unacknowledgedCompleted.current.add(id);
      updateFile(id, { status: 'complete', statusMessage: 'Upload complete!', progress: 100 });

      return {
        successful: { ...upload, uploadURL: uploadParams.url },
        exifData: exifData || null,
        failed: null,
      };

    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      updateFile(id, { status: 'error', statusMessage: 'Upload failed', errorMessage, progress: 0 });
      return { successful: null, exifData: null, failed: { ...upload, error: new Error(errorMessage) } };
    }
  };

  const occupiedSlots = () => {
    return countOccupiedPhotoSlots(existingPhotoCount, filesRef.current, unacknowledgedCompleted.current, acknowledgedUploadIds);
  };

  const processNewFiles = async (newFiles: File[]) => {
    setNotice("");
    const validFiles = newFiles.filter(file => {
      if (file.size > maxFileSize) {
        setNotice(`${file.name} is too large (maximum ${Math.round(maxFileSize / 1024 / 1024)} MB).`);
        return false;
      }
      if (!file.type.startsWith('image/')) {
        setNotice(`${file.name} is not an image.`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;
    // Count active reservations and successful uploads not yet reflected in the editor.
    // Failed files do not reserve space until explicitly retried.
    const occupied = occupiedSlots();
    if (occupied + validFiles.length > maxNumberOfFiles) {
      setNotice(`A trip can have at most ${maxNumberOfFiles} photos. ${Math.max(0, maxNumberOfFiles - occupied)} slots available.`);
      return;
    }
    const newFileStates: FileUploadState[] = validFiles.map(file => ({
      id: `${sessionId.current}-${nextId.current++}`,
      file,
      status: 'queued',
      progress: 0,
      statusMessage: 'Waiting to upload...'
    }));

    updateFiles(prev => [...prev, ...newFileStates]);
    await enqueueBatch(newFileStates);
  };

  const enqueueBatch = (batch: FileUploadState[]) => {
    pendingBatches.current++;
    notifyPending();
    const task = batchTail.current.catch(() => {}).then(() => processBatch(batch)).finally(() => {
      pendingBatches.current--;
      notifyPending();
    });
    batchTail.current = task;
    return task;
  };

  const processBatch = async (batch: FileUploadState[]) => {
    const results = await runUploadQueue(batch, uploadSingleFile, 3);
    const { successful, failed, exifData } = summarizeUploadBatch(results, () => ({} as PhotoExifData));
    // Emit once per batch, including all-failed batches. Retrying only emits the retried files.
    onComplete?.({ successful, failed } as unknown as UploadResult<Record<string, unknown>, Record<string, unknown>>, exifData);
  };

  const handleFilesFromDropContainer = async (newFiles: File[]) => {
    await processNewFiles(newFiles);
  };

  const removeFile = (id: string) => {
    updateFiles(prev => prev.filter(f => f.id !== id));
  };
  const retryFailed = async () => {
    if (pendingBatches.current > 0) return;
    const failed = filesRef.current.filter(f => f.status === 'error');
    if (failed.length === 0) return;
    const occupied = occupiedSlots();
    if (occupied + failed.length > maxNumberOfFiles) {
      setNotice(`Only ${Math.max(0, maxNumberOfFiles - occupied)} photo slots available. Remove failed files or photos before retrying.`);
      return;
    }
    updateFiles(prev => prev.map(f => f.status === 'error' ? { ...f, status: 'queued', statusMessage: 'Waiting to retry...' } : f));
    await enqueueBatch(failed);
  };

  const hasFailedUploads = files.some(f => f.status === 'error');
  const allUploadsComplete = files.length > 0 && files.every(f => f.status === 'complete');

  return (
    <>
      <button
        type="button"
        className={buttonClassName ?? "meta-mono inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors [&>svg]:h-4 [&>svg]:w-4"}
        onClick={() => setShowModal(true)}
      >
        {children}
        <ImageUp strokeWidth={1.5} />
      </button>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload photos</DialogTitle>
            <DialogDescription>
              Photos upload automatically when selected. Up to {maxNumberOfFiles} photos per trip.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {notice && (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Cannot add photos</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            <FileDropZone
              label="Drag photos here or click to browse"
              accept="image/*"
              multiple={maxNumberOfFiles > 1}
              onAddFiles={handleFilesFromDropContainer}
            />

            {files.length > 0 && (
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-semibold">Upload status</h4>

                {hasFailedUploads && (
                  <div className="space-y-2">
                    <Alert variant="destructive">
                      <CircleAlert className="h-4 w-4" />
                      <AlertTitle>Some uploads failed</AlertTitle>
                      <AlertDescription>Failed files can be retried or removed below.</AlertDescription>
                    </Alert>
                    <Button variant="outline" size="sm" disabled={pendingBatches.current > 0} onClick={retryFailed}>
                      Retry failed uploads
                    </Button>
                  </div>
                )}

                {allUploadsComplete && (
                  <Alert variant="success">
                    <CircleCheck className="h-4 w-4" />
                    <AlertTitle>All photos uploaded successfully!</AlertTitle>
                  </Alert>
                )}

                {files.map((fileState) => {
                  const isDone = fileState.status === 'complete';
                  const isError = fileState.status === 'error';
                  return (
                    <div key={fileState.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center gap-2">
                        {isDone ? (
                          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : isError ? (
                          <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
                        ) : (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm">{fileState.file.name}</span>
                        {(isDone || isError) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Remove ${fileState.file.name}`}
                            onClick={() => removeFile(fileState.id)}
                          >
                            <X />
                          </Button>
                        )}
                      </div>

                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{fileState.statusMessage}</span>
                          <span className="text-xs text-muted-foreground">{fileState.progress}%</span>
                        </div>
                        <Progress value={fileState.progress} className="h-1.5" />
                      </div>

                      {isError && fileState.errorMessage && (
                        <div className="mt-2 text-xs text-destructive">
                          {fileState.errorMessage}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setShowModal(false)}>
              {allUploadsComplete ? "Done" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
