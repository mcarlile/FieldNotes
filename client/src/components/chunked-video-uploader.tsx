import { createPortal } from "react-dom";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Button as CarbonButton,
  Modal,
  FileUploaderDropContainer,
  ProgressBar,
  InlineNotification,
  TextInput,
  NumberInput,
  FormGroup,
} from "@carbon/react";
import { Close, Renew } from "@carbon/icons-react";
import { apiRequest } from "@/lib/queryClient";
import { clipOffsetSeconds, parseCameraFilenameTime, readMp4CreationTime } from "@shared/clip-timing";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
// The server takes at most 200 chunks (MAX_CHUNKS in server/routes.ts).
const MAX_FILE_SIZE = 200 * CHUNK_SIZE;
// Uploads that run at once. The server allows 6 per connection, and two keep
// a home connection busy without tripping its rate limit.
const PARALLEL_UPLOADS = 2;
// Waits between attempts at a chunk; long enough to outlast the server's
// one-minute rate-limit window.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
// Clips saved with the old single-file dialog's default color are given a
// palette color by the trip page.
const DEFAULT_CLIP_COLOR = "#3b82f6";

type UploadStatus = "reading" | "queued" | "uploading" | "complete" | "error";

interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  uploadedBytes: number;
  errorMessage?: string;
  url?: string;
  uploadKey?: string;
  uploadToken?: string;
  title: string;
  duration: number | null;
  startTime: number;
  endTime: number;
  startTimeSource: string | null;
}

export interface UploadedClip {
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
  onComplete?: (clips: UploadedClip[]) => void;
  buttonClassName?: string;
  children: React.ReactNode;
  // When the project's route started; used to place the clip on the timeline
  // from the video's recording time.
  routeStartTime?: Date | string | null;
}

function getVideoDuration(videoFile: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(videoFile);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video metadata"));
    };
    video.src = url;
  });
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function videoFormatOf(file: File) {
  return file.type.split("/")[1]?.toUpperCase() || "MP4";
}

export function ChunkedVideoUploader({
  onComplete,
  buttonClassName,
  children,
  routeStartTime,
}: ChunkedVideoUploaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());
  const nextId = useRef(0);

  const updateItem = useCallback((id: string, updates: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  }, []);

  // Recording start from the camera filename, falling back to the MP4's own
  // creation time. Filenames win because exporters such as Insta360 Studio
  // stamp the MP4 with the export time instead of the recording time.
  const detectStartOffset = async (videoFile: File): Promise<{ offset: number; source: string } | null> => {
    const fromName = clipOffsetSeconds(parseCameraFilenameTime(videoFile.name), routeStartTime);
    if (fromName !== null) return { offset: fromName, source: "the filename" };
    try {
      const recordedAt = await readMp4CreationTime(
        async (start, end) => new Uint8Array(await videoFile.slice(start, end).arrayBuffer()),
        videoFile.size,
      );
      const fromMetadata = clipOffsetSeconds(recordedAt, routeStartTime);
      if (fromMetadata !== null) return { offset: fromMetadata, source: "the video's metadata" };
    } catch {
      // Unreadable metadata just means the start time is entered by hand.
    }
    return null;
  };

  const readDetails = async (item: UploadItem) => {
    try {
      const duration = await getVideoDuration(item.file);
      const detected = await detectStartOffset(item.file);
      const start = detected?.offset ?? 0;
      updateItem(item.id, {
        status: "queued",
        duration,
        startTime: start,
        endTime: start + Math.round(duration),
        startTimeSource: detected?.source ?? null,
      });
    } catch (error) {
      updateItem(item.id, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Failed to read video",
      });
    }
  };

  const uploadChunk = async (
    chunk: Blob,
    chunkIndex: number,
    uploadKey: string,
    token: string,
    totalChunks: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const formData = new FormData();
    formData.append("chunk", chunk);
    formData.append("chunkIndex", String(chunkIndex));
    formData.append("totalChunks", String(totalChunks));
    formData.append("uploadKey", uploadKey);
    formData.append("token", token);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        await apiRequest("/api/video/upload-chunk", "POST", formData, { signal });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error; // Don't retry aborted requests
        }
        lastError = error as Error;
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    throw lastError || new Error("Failed to upload chunk after retries");
  };

  // Chunks the server already has, so a retried upload picks up where it
  // stopped. Null when the server no longer knows the upload.
  const getReceivedChunks = async (uploadKey: string, token: string): Promise<Set<number> | null> => {
    try {
      const response = await apiRequest(`/api/video/upload/${uploadKey}/status`, "POST", { token });
      const status = await response.json();
      return new Set<number>(status.receivedChunks ?? []);
    } catch {
      return null;
    }
  };

  const uploadItem = async (item: UploadItem) => {
    const { file } = item;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const controller = new AbortController();
    abortControllers.current.set(item.id, controller);

    try {
      let uploadKey = item.uploadKey;
      let token = item.uploadToken;
      let received = uploadKey && token ? await getReceivedChunks(uploadKey, token) : null;
      if (!uploadKey || !token || !received) {
        const response = await apiRequest("/api/video/init-upload", "POST", undefined, { signal: controller.signal });
        ({ uploadKey, token } = await response.json());
        received = new Set<number>();
      }
      updateItem(item.id, { uploadKey, uploadToken: token });

      for (let i = 0; i < totalChunks; i++) {
        if (received.has(i)) continue;
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        await uploadChunk(file.slice(start, end), i, uploadKey!, token!, totalChunks, controller.signal);
        received.add(i);
        const uploadedBytes = Math.min(received.size * CHUNK_SIZE, file.size);
        updateItem(item.id, { uploadedBytes, progress: Math.round((uploadedBytes / file.size) * 100) });
      }

      const response = await apiRequest(
        "/api/video/complete-upload",
        "POST",
        { uploadKey, token, filename: file.name, contentType: file.type },
        { signal: controller.signal },
      );
      const result = await response.json();
      updateItem(item.id, { status: "complete", progress: 100, uploadedBytes: file.size, url: result.url });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      updateItem(item.id, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      abortControllers.current.delete(item.id);
    }
  };

  // Start queued uploads, a few at a time, in the order they were added.
  useEffect(() => {
    const running = items.filter((item) => item.status === "uploading").length;
    const next = items.filter((item) => item.status === "queued").slice(0, Math.max(0, PARALLEL_UPLOADS - running));
    if (next.length === 0) return;
    setItems((prev) =>
      prev.map((item) => (next.some((n) => n.id === item.id) ? { ...item, status: "uploading" } : item)),
    );
    next.forEach((item) => uploadItem(item));
    // uploadItem only reads the item it's given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const handleFilesAdded = (files: File[]) => {
    const added: UploadItem[] = files.map((file) => {
      const base: UploadItem = {
        id: `upload-${nextId.current++}`,
        file,
        status: "reading",
        progress: 0,
        uploadedBytes: 0,
        title: file.name.replace(/\.[^/.]+$/, ""),
        duration: null,
        startTime: 0,
        endTime: 0,
        startTimeSource: null,
      };
      if (!file.type.startsWith("video/")) {
        return { ...base, status: "error", errorMessage: "Not a video file" };
      }
      if (file.size > MAX_FILE_SIZE) {
        return { ...base, status: "error", errorMessage: `Larger than the ${formatFileSize(MAX_FILE_SIZE)} limit` };
      }
      return base;
    });
    setItems((prev) => [...prev, ...added]);
    added.filter((item) => item.status === "reading").forEach((item) => readDetails(item));
  };

  const removeItem = (id: string) => {
    abortControllers.current.get(id)?.abort();
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const retryItem = (item: UploadItem) => {
    // Files that couldn't be read or are too big can't be retried.
    if (item.duration === null) return;
    updateItem(item.id, { status: "queued", errorMessage: undefined });
  };

  const resetAndClose = () => {
    abortControllers.current.forEach((controller) => controller.abort());
    abortControllers.current.clear();
    setItems([]);
    setShowModal(false);
  };

  const completed = items.filter((item) => item.status === "complete");
  const inProgress = items.some((item) => ["reading", "queued", "uploading"].includes(item.status));
  const timesValid = completed.every((item) => item.endTime > item.startTime && item.startTime >= 0);
  const titlesValid = completed.every((item) => item.title.trim().length > 0);
  const canAdd = completed.length > 0 && !inProgress && timesValid && titlesValid;

  const handleSubmit = () => {
    if (!canAdd) return;
    onComplete?.(
      completed.map((item) => ({
        title: item.title.trim(),
        filename: item.file.name,
        url: item.url!,
        startTime: item.startTime,
        endTime: item.endTime,
        duration: item.endTime - item.startTime,
        color: DEFAULT_CLIP_COLOR,
        fileSize: formatFileSize(item.file.size),
        videoFormat: videoFormatOf(item.file),
      })),
    );
    resetAndClose();
  };

  const statusText = (item: UploadItem) => {
    switch (item.status) {
      case "reading":
        return "Reading video...";
      case "queued":
        return "Waiting to upload";
      case "uploading":
        return `Uploading ${formatFileSize(item.uploadedBytes)} / ${formatFileSize(item.file.size)}`;
      case "complete":
        return `Uploaded, ${formatFileSize(item.file.size)}`;
      case "error":
        return item.errorMessage || "Upload failed";
    }
  };

  const primaryText = inProgress
    ? `Uploading ${items.filter((item) => item.status !== "complete" && item.status !== "error").length} of ${items.length}...`
    : completed.length === 1
      ? "Add clip"
      : `Add ${completed.length} clips`;

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

      {/* On the body, so a card or panel the button sits in can't clip or trap it. */}
      {createPortal(
        <Modal
          open={showModal}
          onRequestClose={resetAndClose}
          modalHeading="Upload video clips"
          primaryButtonText={primaryText}
          secondaryButtonText="Cancel"
          onRequestSubmit={handleSubmit}
          onSecondarySubmit={resetAndClose}
          primaryButtonDisabled={!canAdd}
          size="lg"
          data-testid="modal-video-upload"
        >
          <div className="space-y-6">
            <FormGroup legendText="Video files">
              <FileUploaderDropContainer
                accept={["video/*"]}
                multiple
                labelText="Drag and drop video files here or click to browse"
                onAddFiles={(_, { addedFiles }) => {
                  if (addedFiles.length > 0) handleFilesAdded(Array.from(addedFiles as File[]));
                }}
                data-testid="drop-container-video"
              />
              <div className="text-sm text-muted-foreground mt-2">
                <p>MP4, WebM, MOV or AVI, up to 4K, each up to {formatFileSize(MAX_FILE_SIZE)}.</p>
                <p className="mt-1 text-xs">Pick several at once; they upload {PARALLEL_UPLOADS} at a time.</p>
              </div>
            </FormGroup>

            {items.length > 0 && (
              <div className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className="border border-border rounded p-3 space-y-2" data-testid={`upload-item-${item.file.name}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate" title={item.file.name}>{item.file.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.status === "error" && item.duration !== null && (
                          <CarbonButton kind="ghost" size="sm" renderIcon={Renew} onClick={() => retryItem(item)} data-testid="button-retry-upload">
                            Retry
                          </CarbonButton>
                        )}
                        <CarbonButton
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          renderIcon={Close}
                          iconDescription="Remove"
                          onClick={() => removeItem(item.id)}
                          data-testid="button-remove-upload"
                        />
                      </div>
                    </div>

                    {item.status === "error" ? (
                      <InlineNotification kind="error" title="Upload error" subtitle={statusText(item)} hideCloseButton lowContrast />
                    ) : (
                      <ProgressBar
                        value={item.status === "complete" ? 100 : item.progress}
                        max={100}
                        size="small"
                        label={statusText(item)}
                        hideLabel={false}
                      />
                    )}

                    {item.duration !== null && item.status !== "error" && (
                      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
                        <TextInput
                          id={`${item.id}-title`}
                          labelText="Clip title"
                          size="sm"
                          value={item.title}
                          invalid={!item.title.trim()}
                          invalidText="Required"
                          onChange={(e) => updateItem(item.id, { title: e.target.value })}
                          data-testid="input-clip-title"
                        />
                        <NumberInput
                          id={`${item.id}-start`}
                          label="Start (s after route start)"
                          size="sm"
                          hideSteppers
                          min={0}
                          value={item.startTime}
                          onChange={(e) => {
                            const start = Number((e.target as HTMLInputElement).value);
                            updateItem(item.id, { startTime: start, endTime: start + Math.round(item.duration ?? 0) });
                          }}
                          data-testid="input-start-time"
                        />
                        <NumberInput
                          id={`${item.id}-end`}
                          label="End (s after route start)"
                          size="sm"
                          hideSteppers
                          min={0}
                          value={item.endTime}
                          invalid={item.endTime <= item.startTime}
                          invalidText="Must be after start"
                          onChange={(e) => updateItem(item.id, { endTime: Number((e.target as HTMLInputElement).value) })}
                          data-testid="input-end-time"
                        />
                      </div>
                    )}

                    {item.duration !== null && item.status !== "error" && (
                      <div className="text-xs text-muted-foreground">
                        Length {formatTime(item.duration)}
                        {item.startTimeSource
                          ? ` · start from ${item.startTimeSource}`
                          : " · start time not found, enter it by hand"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>,
        document.body,
      )}
    </div>
  );
}
