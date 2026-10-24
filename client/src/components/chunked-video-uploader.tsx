import { useState, useRef, useEffect } from "react";
import {
  Button as CarbonButton,
  Modal,
  FileUploaderDropContainer,
  ProgressBar,
  InlineNotification,
  TextInput,
  NumberInput,
} from "@carbon/react";
import { Close, Renew } from "@carbon/icons-react";
import { apiRequest } from "@/lib/queryClient";
import { clipOffsetSeconds, parseCameraFilenameTime, readMp4CreationTime } from "@shared/clip-timing";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
const MAX_FILE_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB
const DEFAULT_COLOR = "#3b82f6";

type ItemStatus = 'queued' | 'uploading' | 'complete' | 'error';

// One video in the upload batch, with the clip details that will be saved for it.
interface UploadItem {
  id: string;
  file: File;
  status: ItemStatus;
  progress: number;
  errorMessage?: string;
  url?: string;
  uploadKey?: string;
  uploadToken?: string;
  title: string;
  startTime: number;
  duration: number;
  startTimeSource: string | null;
}

export interface UploadedClipData {
  title: string;
  filename: string;
  url: string;
  startTime: number;
  endTime: number;
  duration: number;
  color: string;
  fileSize: string;
  videoFormat: string;
}

interface ChunkedVideoUploaderProps {
  // Called once per clip when the batch is added.
  onComplete?: (clipData: UploadedClipData) => void;
  buttonClassName?: string;
  children: React.ReactNode;
  // When the project's route started; used to place each clip on the timeline
  // from the video's recording time.
  routeStartTime?: Date | string | null;
}

const getVideoDuration = (videoFile: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(videoFile);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };
    video.src = url;
  });

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mmss = `${mins.toString().padStart(hours ? 2 : 1, '0')}:${secs.toString().padStart(2, '0')}`;
  return hours ? `${hours}:${mmss}` : mmss;
};

const formatFileSize = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const videoFormatOf = (file: File) => file.type.split('/')[1]?.toUpperCase() || 'MP4';

export function ChunkedVideoUploader({
  onComplete,
  buttonClassName,
  children,
  routeStartTime,
}: ChunkedVideoUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [shiftSeconds, setShiftSeconds] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadingRef = useRef(false);
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  const updateItem = (id: string, changes: Partial<UploadItem>) =>
    setItems(prev => prev.map(item => (item.id === id ? { ...item, ...changes } : item)));

  // Recording start from the camera filename, falling back to the MP4's own
  // creation time. Filenames win because exporters such as Insta360 Studio
  // stamp the MP4 with the export time instead of the recording time.
  const detectStartOffset = async (videoFile: File): Promise<{ offset: number; source: string } | null> => {
    const fromName = clipOffsetSeconds(parseCameraFilenameTime(videoFile.name), routeStartTime);
    if (fromName !== null) return { offset: fromName, source: "filename" };
    try {
      const recordedAt = await readMp4CreationTime(
        async (start, end) => new Uint8Array(await videoFile.slice(start, end).arrayBuffer()),
        videoFile.size,
      );
      const fromMetadata = clipOffsetSeconds(recordedAt, routeStartTime);
      if (fromMetadata !== null) return { offset: fromMetadata, source: "metadata" };
    } catch {
      // Unreadable metadata just means the start time is entered by hand.
    }
    return null;
  };

  const uploadChunk = async (
    chunk: Blob,
    chunkIndex: number,
    uploadKey: string,
    token: string,
    totalChunks: number,
    signal: AbortSignal,
    retries: number = 3
  ): Promise<void> => {
    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('totalChunks', String(totalChunks));
    formData.append('uploadKey', uploadKey);
    formData.append('token', token);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await apiRequest("/api/video/upload-chunk", "POST", formData, { signal });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error; // Don't retry aborted requests
        }
        lastError = error as Error;
        if (attempt < retries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError || new Error('Failed to upload chunk after retries');
  };

  const getReceivedChunks = async (uploadKey: string, token: string): Promise<Set<number>> => {
    try {
      const response = await apiRequest(`/api/video/upload/${uploadKey}/status`, "POST", { token });
      const status: { receivedChunks?: number[] } = await response.json();
      return new Set(status.receivedChunks || []);
    } catch {
      return new Set();
    }
  };

  // Uploads one file, resuming from the chunks the server already has when a
  // previous attempt got part of the way.
  const uploadItem = async (item: UploadItem, signal: AbortSignal) => {
    const totalChunks = Math.ceil(item.file.size / CHUNK_SIZE);
    updateItem(item.id, { status: 'uploading', errorMessage: undefined });

    try {
      let { uploadKey, uploadToken: token } = item;
      let received = new Set<number>();
      if (uploadKey && token) {
        received = await getReceivedChunks(uploadKey, token);
      } else {
        const response = await apiRequest("/api/video/init-upload", "POST");
        const init: { uploadKey: string; token: string } = await response.json();
        uploadKey = init.uploadKey;
        token = init.token;
        updateItem(item.id, { uploadKey, uploadToken: token });
      }

      for (let i = 0; i < totalChunks; i++) {
        if (received.has(i)) continue;
        const start = i * CHUNK_SIZE;
        const chunk = item.file.slice(start, Math.min(start + CHUNK_SIZE, item.file.size));
        await uploadChunk(chunk, i, uploadKey, token!, totalChunks, signal);
        received.add(i);
        updateItem(item.id, { progress: Math.round((received.size / totalChunks) * 100) });
      }

      const response = await apiRequest(
        "/api/video/complete-upload",
        "POST",
        { uploadKey, token, filename: item.file.name, contentType: item.file.type },
      );
      const result: { url: string } = await response.json();
      updateItem(item.id, { status: 'complete', progress: 100, url: result.url });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      updateItem(item.id, {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  };

  // Uploads queued files one at a time, so a big batch doesn't swamp the server.
  const processQueue = async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;
    try {
      while (!signal.aborted) {
        const next = itemsRef.current.find(item => item.status === 'queued');
        if (!next) break;
        await uploadItem(next, signal);
      }
    } finally {
      uploadingRef.current = false;
    }
  };

  // Kick the queue whenever new files are waiting.
  useEffect(() => {
    if (items.some(item => item.status === 'queued')) {
      void processQueue();
    }
  }, [items]);

  const handleFilesAdded = async (files: File[]) => {
    const prepared = await Promise.all(files.map(async (file, index): Promise<UploadItem> => {
      const base: UploadItem = {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        status: 'queued',
        progress: 0,
        title: file.name.replace(/\.[^/.]+$/, ""),
        startTime: 0,
        duration: 0,
        startTimeSource: null,
      };
      if (!file.type.startsWith('video/')) {
        return { ...base, status: 'error', errorMessage: 'Not a video file' };
      }
      if (file.size > MAX_FILE_SIZE) {
        return { ...base, status: 'error', errorMessage: 'File size exceeds 1.5GB limit' };
      }
      try {
        const duration = await getVideoDuration(file);
        const detected = await detectStartOffset(file);
        return {
          ...base,
          duration,
          startTime: detected?.offset ?? 0,
          startTimeSource: detected?.source ?? null,
        };
      } catch (error) {
        return {
          ...base,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Failed to read video',
        };
      }
    }));

    // Keep the batch in timeline order.
    setItems(prev => [...prev, ...prepared].sort((a, b) => a.startTime - b.startTime));
  };

  const removeItem = (id: string) => {
    const item = itemsRef.current.find(i => i.id === id);
    if (item?.status === 'uploading') return;
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const retryItem = (id: string) => {
    const item = itemsRef.current.find(i => i.id === id);
    // Files rejected before uploading (wrong type, too big) can't be retried.
    if (!item || !item.duration) return;
    updateItem(id, { status: 'queued', errorMessage: undefined });
  };

  const applyShift = () => {
    if (!shiftSeconds) return;
    setItems(prev => prev.map(item => ({ ...item, startTime: Math.max(0, item.startTime + shiftSeconds) })));
    setShiftSeconds(0);
  };

  const resetAndClose = () => {
    abortControllerRef.current?.abort();
    setItems([]);
    setShiftSeconds(0);
    setShowModal(false);
  };

  const completeItems = items.filter(item => item.status === 'complete' && item.url);
  const pendingCount = items.filter(item => item.status === 'queued' || item.status === 'uploading').length;
  const failedCount = items.filter(item => item.status === 'error').length;
  const canSubmit = completeItems.length > 0 && pendingCount === 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    for (const item of completeItems) {
      const duration = Math.max(1, Math.round(item.duration));
      onComplete?.({
        title: item.title.trim() || item.file.name,
        filename: item.file.name,
        url: item.url!,
        startTime: item.startTime,
        endTime: item.startTime + duration,
        duration,
        color: DEFAULT_COLOR,
        fileSize: formatFileSize(item.file.size),
        videoFormat: videoFormatOf(item.file),
      });
    }
    resetAndClose();
  };

  const primaryText = canSubmit
    ? `Add ${completeItems.length} clip${completeItems.length === 1 ? '' : 's'}`
    : pendingCount > 0
      ? `Uploading ${pendingCount} of ${items.length}...`
      : "Add clips";

  return (
    <div>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={buttonClassName ?? "meta-mono px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"}
        data-testid="button-upload-video"
      >
        {children}
      </button>

      <Modal
        open={showModal}
        onRequestClose={resetAndClose}
        modalHeading="Upload Video Clips"
        primaryButtonText={primaryText}
        secondaryButtonText="Cancel"
        onRequestSubmit={handleSubmit}
        onSecondarySubmit={resetAndClose}
        primaryButtonDisabled={!canSubmit}
        size="lg"
        data-testid="modal-video-upload"
      >
        <div className="space-y-6">
          <div>
            <FileUploaderDropContainer
              accept={['video/*']}
              multiple
              labelText="Drag and drop video files here or click to browse"
              onAddFiles={(_, { addedFiles }) => {
                if (addedFiles.length > 0) void handleFilesAdded(addedFiles);
              }}
              data-testid="drop-container-video"
            />
            <div className="text-sm text-muted-foreground mt-2">
              <p>Select several videos at once. Each start time is read from the camera filename or the video's metadata, and you can adjust any of them before adding.</p>
              <p className="mt-1 text-xs">MP4, WebM, MOV, AVI · up to 1.5GB each · uploads run one at a time and resume after errors</p>
            </div>
          </div>

          {items.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-end gap-3">
                <div className="w-56">
                  <NumberInput
                    id="shift-all"
                    label="Shift all start times (seconds)"
                    step={1}
                    value={shiftSeconds}
                    allowEmpty
                    onChange={(_e, { value }) => setShiftSeconds(Number(value) || 0)}
                    data-testid="input-shift-all"
                  />
                </div>
                <CarbonButton kind="tertiary" size="md" onClick={applyShift} disabled={!shiftSeconds} data-testid="button-apply-shift">
                  Apply to all
                </CarbonButton>
              </div>

              <div className="divide-y divide-border border border-border rounded">
                {items.map(item => (
                  <div key={item.id} className="p-3 space-y-2" data-testid={`upload-item-${item.file.name}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate" title={item.file.name}>{item.file.name}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {item.duration ? `${formatTime(item.duration)} · ` : ''}{formatFileSize(item.file.size)}
                        </span>
                        {item.status === 'error' && item.duration > 0 && (
                          <CarbonButton kind="ghost" size="sm" hasIconOnly renderIcon={Renew} iconDescription="Retry" onClick={() => retryItem(item.id)} />
                        )}
                        {item.status !== 'uploading' && (
                          <CarbonButton kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Remove" onClick={() => removeItem(item.id)} />
                        )}
                      </div>
                    </div>

                    {item.status === 'error' ? (
                      <InlineNotification
                        kind="error"
                        lowContrast
                        title="Upload error"
                        subtitle={item.errorMessage || 'Upload failed'}
                        hideCloseButton
                      />
                    ) : (
                      <>
                        {item.status !== 'complete' && (
                          <ProgressBar
                            value={item.progress}
                            max={100}
                            size="small"
                            label={item.status === 'queued' ? 'Waiting' : `Uploading ${item.progress}%`}
                            hideLabel={false}
                          />
                        )}
                        <div className="grid grid-cols-[1fr_10rem] gap-3 items-end">
                          <TextInput
                            id={`title-${item.id}`}
                            labelText="Title"
                            value={item.title}
                            onChange={(e) => updateItem(item.id, { title: e.target.value })}
                          />
                          <NumberInput
                            id={`start-${item.id}`}
                            label="Start (s after route start)"
                            min={0}
                            step={1}
                            value={item.startTime}
                            onChange={(_e, { value }) => updateItem(item.id, { startTime: Math.max(0, Number(value) || 0) })}
                          />
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime(item.startTime)} → {formatTime(item.startTime + item.duration)}
                          {item.startTimeSource ? ` · start from ${item.startTimeSource}` : ' · start not detected, set it by hand'}
                          {item.status === 'complete' && ' · uploaded'}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {failedCount > 0 && pendingCount === 0 && completeItems.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {failedCount} file{failedCount === 1 ? '' : 's'} failed and won't be added unless retried.
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
