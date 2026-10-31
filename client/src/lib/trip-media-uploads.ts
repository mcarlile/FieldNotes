import { useSyncExternalStore } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseCameraFilenameTime, readMp4CreationTime } from "@shared/clip-timing";

/**
 * Photos and videos picked while a trip is being created upload here, after
 * the trip exists, so the create dialog can close right away. The queue lives
 * at module level: it keeps going while you move around the app, and a
 * browser notification says when a trip's videos are up. The server
 * processes each clip on its own once it's added.
 */

export type MediaKind = "photo" | "video";
type ItemStatus = "queued" | "uploading" | "done" | "error";

export interface MediaUploadItem {
  id: string;
  tripId: string;
  tripTitle: string;
  kind: MediaKind;
  file: File;
  status: ItemStatus;
  loaded: number;
  error?: string;
}

// Videos are large: two at a time keeps a home connection busy. Photos are
// small and go a few at a time.
const PARALLEL = { video: 2, photo: 4 } as const;
const RETRIES = 2;

let items: MediaUploadItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  items = [...items];
  listeners.forEach((listener) => listener());
}

function update(id: string, patch: Partial<MediaUploadItem>) {
  const item = items.find((i) => i.id === id);
  if (item) Object.assign(item, patch);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTripMediaUploads() {
  return useSyncExternalStore(subscribe, () => items);
}

export function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name);
}

export function isPhotoFile(file: File) {
  return file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
}

/**
 * Asks for notification permission. Call it from the click that picks
 * videos, since browsers only show the prompt after a user gesture.
 */
export function requestUploadNotifications() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** Queues a new trip's photos and videos. Returns right away. */
export function startTripMediaUploads(trip: { id: string; title: string }, photos: File[], videos: File[]) {
  const added: MediaUploadItem[] = [
    ...photos.map((file) => ({ kind: "photo" as const, file })),
    ...videos.map((file) => ({ kind: "video" as const, file })),
  ].map(({ kind, file }) => ({
    id: `media-${nextId++}`,
    tripId: trip.id,
    tripTitle: trip.title,
    kind,
    file,
    status: "queued",
    loaded: 0,
  }));
  if (added.length === 0) return;
  items.push(...added);
  emit();
  pump();
}

/** Clears finished rows from the status card. */
export function dismissFinishedUploads() {
  items = items.filter((i) => i.status === "queued" || i.status === "uploading");
  emit();
}

function pump() {
  for (const kind of ["video", "photo"] as const) {
    const running = items.filter((i) => i.kind === kind && i.status === "uploading").length;
    const next = items
      .filter((i) => i.kind === kind && i.status === "queued")
      .slice(0, Math.max(0, PARALLEL[kind] - running));
    for (const item of next) {
      update(item.id, { status: "uploading" });
      run(item);
    }
  }
}

async function run(item: MediaUploadItem) {
  try {
    if (item.kind === "video") await uploadVideo(item);
    else await uploadPhoto(item);
    update(item.id, { status: "done", loaded: item.file.size });
  } catch (error) {
    update(item.id, { status: "error", error: error instanceof Error ? error.message : "Upload failed" });
  }
  finishTripIfDone(item.tripId, item.kind);
  pump();
}

async function uploadPhoto(item: MediaUploadItem) {
  const url = await putToStorage(item, "/api/photos/upload");
  // The server reads location, time and camera from the file afterwards.
  await apiRequest("/api/photos", "POST", { fieldNoteId: item.tripId, filename: item.file.name, url });
}

async function uploadVideo(item: MediaUploadItem) {
  const { file } = item;
  const duration = await videoDuration(file);
  const recordedAt = await videoRecordedAt(file);
  const url = await putToStorage(item, "/api/objects/upload");
  await apiRequest("/api/video-clips", "POST", {
    fieldNoteId: item.tripId,
    title: file.name.replace(/\.[^/.]+$/, ""),
    filename: file.name,
    url,
    duration: Math.round(duration * 1000) / 1000,
    // The server turns this into the clip's place on the route.
    recordedAt: recordedAt?.toISOString(),
    fileSize: formatFileSize(file.size),
    videoFormat: file.name.split(".").pop()?.toUpperCase() || "MP4",
  });
}

/** PUTs the file to a fresh signed URL, retrying with a new URL on failure. */
async function putToStorage(item: MediaUploadItem, signEndpoint: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { uploadURL } = await (await apiRequest(signEndpoint, "POST")).json();
      await putWithProgress(uploadURL, item.file, (loaded) => update(item.id, { loaded }));
      return uploadURL;
    } catch (error) {
      lastError = error;
      update(item.id, { loaded: 0 });
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}

function putWithProgress(url: string, file: File, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(file);
  });
}

function videoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read this video"));
    };
    video.src = url;
  });
}

// Camera filenames win over MP4 metadata, as in the trip page's uploader:
// exporters such as Insta360 Studio stamp the MP4 with the export time.
async function videoRecordedAt(file: File): Promise<Date | null> {
  const fromName = parseCameraFilenameTime(file.name);
  if (fromName) return fromName;
  try {
    return await readMp4CreationTime(
      async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
      file.size,
    );
  } catch {
    return null;
  }
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function finishTripIfDone(tripId: string, kind: MediaKind) {
  queryClient.invalidateQueries({ queryKey: ["/api/field-notes"] });
  if (kind === "video") queryClient.invalidateQueries({ queryKey: ["/api/video-clips", tripId] });
  if (kind !== "video") return;
  // One notification for the trip, once its last video is up.
  const videos = items.filter((i) => i.tripId === tripId && i.kind === "video");
  if (videos.some((i) => i.status === "queued" || i.status === "uploading")) return;
  const done = videos.filter((i) => i.status === "done").length;
  notify(videos[0].tripTitle, done, videos.length - done);
}

function notify(tripTitle: string, done: number, failed: number) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title = done > 0
    ? `${done} video${done === 1 ? "" : "s"} uploaded`
    : "Video upload failed";
  const body = failed > 0 && done > 0
    ? `${tripTitle}: ${failed} couldn't upload. They'll play once processing finishes.`
    : done > 0
      ? `${tripTitle}: they'll play once processing finishes.`
      : `${tripTitle}: ${failed} video${failed === 1 ? "" : "s"} couldn't upload.`;
  try {
    new Notification(title, { body, tag: `trip-videos-${tripTitle}` });
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

/** Keeps the browser from closing the tab while uploads are running. */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (items.some((i) => i.status === "queued" || i.status === "uploading")) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
