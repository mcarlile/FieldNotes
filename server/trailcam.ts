import { storage } from "./storage";
import { objectStorageService } from "./objectStorage";
import { startVideoProcessing } from "./videoProcessor";
import { compactTimedTrack, parseGpxData, resolveClipCoordinates, type ProjectGpxData } from "@shared/gpx-utils";
import type { InsertVideoClip, TrailcamProject, VideoClip } from "@shared/schema";

/** Creates a TrailCam project from raw GPX, keeping the timed track for clip placement. */
export async function createProjectFromGpx(params: {
  title: string;
  description?: string;
  gpxContent: string;
  filename?: string;
}): Promise<TrailcamProject> {
  const stats = parseGpxData(params.gpxContent);
  const timedTrack = compactTimedTrack(params.gpxContent);
  const gpxData: ProjectGpxData & { filename?: string } = {
    ...stats,
    timedTrack,
    filename: params.filename,
  };
  const startTime = timedTrack ? new Date(timedTrack.startTime) : stats.date ?? undefined;

  return storage.createTrailcamProject({
    title: params.title,
    description: params.description,
    gpxData,
    duration: timedTrack?.durationSeconds,
    startTime,
    endTime: timedTrack && startTime
      ? new Date(startTime.getTime() + timedTrack.durationSeconds * 1000)
      : undefined,
  });
}

/**
 * Creates a video clip: normalizes its storage URL, places it on the route
 * from its time offsets, and starts transcoding in the background.
 */
export async function createClipWithCoordinates(data: InsertVideoClip): Promise<VideoClip> {
  const clipData = { ...data };
  if (clipData.url) {
    clipData.url = objectStorageService.normalizeObjectEntityPath(clipData.url);
  }

  const project = await storage.getTrailcamProjectById(clipData.projectId);
  if (project?.gpxData) {
    const coords = resolveClipCoordinates(
      project.gpxData,
      clipData.startTime,
      clipData.endTime,
      project.duration || undefined
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
