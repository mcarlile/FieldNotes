import { storage } from "./storage";
import { objectStorageService } from "./objectStorage";
import { startVideoProcessing } from "./videoProcessor";
import { compactTimedTrack, parseGpxData, resolveClipCoordinates, type ProjectGpxData } from "@shared/gpx-utils";
import type { FieldNote, InsertVideoClip, VideoClip } from "@shared/schema";

/** Length of a trip's timed track in seconds, when its GPX had timestamps. */
export function tripDurationSeconds(trip: Pick<FieldNote, "gpxData" | "startTime" | "endTime">): number | null {
  const timed = (trip.gpxData as { timedTrack?: { durationSeconds?: number } | null } | null)?.timedTrack;
  if (typeof timed?.durationSeconds === "number") return timed.durationSeconds;
  if (trip.startTime && trip.endTime) {
    return (new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime()) / 1000;
  }
  return null;
}

/** Creates a trip from raw GPX, keeping the timed track so video clips can be placed on it. */
export async function createTripFromGpx(params: {
  userId: string;
  title: string;
  description?: string;
  tripType?: string[];
  gpxContent: string;
  filename?: string;
}): Promise<FieldNote> {
  const stats = parseGpxData(params.gpxContent);
  const timedTrack = compactTimedTrack(params.gpxContent);
  const gpxData: ProjectGpxData & { filename?: string } = {
    ...stats,
    timedTrack,
    filename: params.filename,
  };
  const startTime = timedTrack ? new Date(timedTrack.startTime) : stats.date ?? null;

  return storage.createFieldNote({
    userId: params.userId,
    title: params.title,
    description: params.description ?? "",
    tripType: params.tripType ?? [],
    date: startTime ?? new Date(),
    distance: Math.round(stats.distance * 10) / 10,
    elevationGain: Math.round(stats.elevationGain),
    gpxData,
    startTime,
    endTime: timedTrack && startTime
      ? new Date(startTime.getTime() + timedTrack.durationSeconds * 1000)
      : null,
  });
}

/**
 * Replaces a trip's route with raw GPX that has timestamps, so clips can be
 * placed by recorded time. Keeps other gpxData fields such as the sync offset.
 * Returns null when the GPX has no timed points.
 */
export async function replaceTripRoute(trip: FieldNote, gpxContent: string, filename?: string): Promise<FieldNote | null> {
  const timedTrack = compactTimedTrack(gpxContent);
  if (!timedTrack) return null;
  const stats = parseGpxData(gpxContent);
  const startTime = new Date(timedTrack.startTime);
  const updated = await storage.updateFieldNote(trip.id, {
    gpxData: {
      ...((trip.gpxData as Record<string, unknown> | null) ?? {}),
      ...stats,
      timedTrack,
      filename: filename ?? (trip.gpxData as { filename?: string } | null)?.filename,
    },
    startTime,
    endTime: new Date(startTime.getTime() + timedTrack.durationSeconds * 1000),
  });
  return updated ?? null;
}

/**
 * Creates a video clip on a trip: normalizes its storage URL, places it on
 * the route from its time offsets, and starts transcoding in the background.
 */
export async function createClipWithCoordinates(data: InsertVideoClip & { fieldNoteId: string }): Promise<VideoClip> {
  const clipData = { ...data };
  if (clipData.url) {
    clipData.url = objectStorageService.normalizeObjectEntityPath(clipData.url);
  }

  const trip = await storage.getFieldNoteById(clipData.fieldNoteId);
  if (trip?.gpxData) {
    const coords = resolveClipCoordinates(
      trip.gpxData,
      clipData.startTime,
      clipData.endTime,
      tripDurationSeconds(trip) ?? undefined
    );
    console.log(`Calculated clip coordinates: start(${coords.startLatitude}, ${coords.startLongitude}), end(${coords.endLatitude}, ${coords.endLongitude})`);

    clipData.startLatitude = coords.startLatitude;
    clipData.startLongitude = coords.startLongitude;
    clipData.endLatitude = coords.endLatitude;
    clipData.endLongitude = coords.endLongitude;
  }

  const clip = await storage.createVideoClip(clipData);

  // Start async video processing (transcoding + thumbnail generation)
  console.log(`Starting video processing for clip ${clip.id}`);
  startVideoProcessing(clip.id);
  return clip;
}
