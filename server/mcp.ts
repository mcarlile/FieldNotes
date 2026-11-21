import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { objectStorageService } from "./objectStorage";
import { requireAuth } from "./middlewares/clerkAuth";
import { createClipWithCoordinates, createTripFromGpx, replaceTripRoute, tripDurationSeconds } from "./trailcam";
import { clipOffsetSeconds, routeStartOf } from "@shared/clip-timing";
import { resolveClipCoordinates } from "@shared/gpx-utils";
import { isVideoProcessingActive, reprocessVideoClip } from "./videoProcessor";
import type { FieldNote } from "@shared/schema";
import { StravaImportError, addPhotoToTrip, importStravaActivity, importStravaPhotos, listStravaActivities } from "./stravaImport";

/**
 * A small Model Context Protocol server (Streamable HTTP, stateless, JSON
 * responses) so Claude can create trips and add video clips for the
 * signed-in user. A "project" in the tool names is a trip: TrailCam Studio
 * projects became trips with the same ids. Video bytes never pass through MCP: `request_upload` hands
 * out a signed storage URL that the client PUTs the file to directly.
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_GPX_BYTES = 25 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 900;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

class ToolError extends Error {}

const tools = [
  {
    name: "list_projects",
    description: "List your trips, newest first, with how many photos and video clips each has.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Only trips whose title or description matches." },
        has_videos: { type: "boolean", description: "Only trips that have video clips." },
      },
    },
  },
  {
    name: "get_project",
    description: "Get one trip with its route start time and its video clips.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
    },
  },
  {
    name: "request_upload",
    description:
      "Get a signed URL to upload one file (a video or a GPX file) to Big Miles storage. " +
      "PUT the raw file bytes to upload_url with the same Content-Type, for example " +
      "`curl -T clip.mp4 -H 'Content-Type: video/mp4' '<upload_url>'`, then pass object_path " +
      "to create_project or add_clip. The URL must be used within 15 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        content_type: { type: "string", description: "MIME type of the file, e.g. video/mp4 or application/gpx+xml." },
      },
    },
  },
  {
    name: "create_project",
    description:
      "Create a trip from a GPX route, ready for video clips. Pass the GPX either inline as `gpx` " +
      "or, for large files, as `gpx_object_path` from request_upload. The route's first timed " +
      "point becomes the trip start. Returns the trip id to use as project_id.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        gpx: { type: "string", description: "GPX file contents." },
        gpx_object_path: { type: "string", description: "object_path of an uploaded GPX file." },
        gpx_filename: { type: "string" },
        trip_type: {
          type: "array",
          items: { type: "string" },
          description: "Activity types, e.g. [\"hike\"]. Optional.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "set_route",
    description:
      "Replace an existing trip's route with a GPX that has a timestamp on each point, so clips can " +
      "be placed with recorded_at. Pass `gpx` inline or `gpx_object_path` from request_upload. " +
      "Photos and clips stay; existing clips keep their start_seconds.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        gpx: { type: "string", description: "GPX file contents." },
        gpx_object_path: { type: "string", description: "object_path of an uploaded GPX file." },
        gpx_filename: { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "add_clip",
    description:
      "Add an uploaded video to a trip. Place it with `recorded_at` (the UTC time the video " +
      "starts, e.g. from the original camera file's creation_time) or `start_seconds` (seconds " +
      "after the route start). The clip is transcoded in the background.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        object_path: { type: "string", description: "object_path returned by request_upload." },
        filename: { type: "string" },
        duration_seconds: { type: "number" },
        title: { type: "string", description: "Defaults to the filename without its extension." },
        recorded_at: { type: "string", description: "ISO 8601 UTC time the video starts." },
        start_seconds: { type: "number", description: "Seconds after the route start." },
        color: { type: "string", description: "Timeline color as #rrggbb." },
        file_size_bytes: { type: "number" },
      },
      required: ["project_id", "object_path", "filename", "duration_seconds"],
    },
  },
  {
    name: "move_clip",
    description:
      "Change where a clip sits on its trip's route. Pass `start_seconds` (seconds after the route " +
      "start) or `recorded_at` (UTC time the video starts); the clip keeps its length.",
    inputSchema: {
      type: "object",
      properties: {
        clip_id: { type: "string" },
        start_seconds: { type: "number", description: "Seconds after the route start." },
        recorded_at: { type: "string", description: "ISO 8601 UTC time the video starts." },
      },
      required: ["clip_id"],
    },
  },
  {
    name: "reprocess_clip",
    description:
      "Retry processing (thumbnail and transcode) for a clip that failed or is stuck. A clip is stuck " +
      "when get_project shows it pending or processing with processing_active false.",
    inputSchema: {
      type: "object",
      properties: { clip_id: { type: "string" } },
      required: ["clip_id"],
    },
  },
  {
    name: "list_strava_activities",
    description:
      "List your Strava activities, newest first, each with the trip that already holds it (linked by Strava id, " +
      "or the same outing by date and distance) or trip_id null when it isn't in Big Miles yet. Uses one Strava " +
      "request per 200 activities.",
    inputSchema: {
      type: "object",
      properties: {
        after: { type: "string", description: "Only activities that start after this ISO 8601 time." },
        before: { type: "string", description: "Only activities that start before this ISO 8601 time." },
        only_missing: { type: "boolean", description: "Only activities that aren't trips yet." },
        max_pages: { type: "number", description: "Pages of 200 to read, default 10." },
      },
    },
  },
  {
    name: "import_strava_activity",
    description:
      "Make a trip from one Strava activity, with its timed GPS track (so clips can be placed) and a copy of the " +
      "photos attached to the activity on Strava. Refuses an activity that is already linked to a trip.",
    inputSchema: {
      type: "object",
      properties: {
        strava_id: { type: "string" },
        title: { type: "string", description: "Defaults to the Strava name." },
        trip_type: { type: "array", items: { type: "string" }, description: "Defaults from the Strava sport." },
        include_photos: { type: "boolean", description: "Copy the Strava photos, default true." },
      },
      required: ["strava_id"],
    },
  },
  {
    name: "import_strava_photos",
    description: "Copy the photos attached to a Strava activity into an existing trip. Photos already copied are skipped.",
    inputSchema: {
      type: "object",
      properties: { strava_id: { type: "string" }, project_id: { type: "string" } },
      required: ["strava_id", "project_id"],
    },
  },
  {
    name: "add_photo",
    description:
      "Add one photo to a trip, sent inline as base64 (JPEG or PNG, up to 30 MB; convert HEIC to JPEG first so browsers can show it). Location and time are read " +
      "from EXIF; latitude, longitude and taken_at fill in when EXIF has none. A filename already on the trip is " +
      "skipped, so retries are safe.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        filename: { type: "string" },
        image_base64: { type: "string" },
        content_type: { type: "string", description: "Default image/jpeg." },
        caption: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
        taken_at: { type: "string", description: "ISO 8601 time the photo was taken." },
      },
      required: ["project_id", "filename", "image_base64"],
    },
  },
];

const addPhotoArgs = z.object({
  project_id: z.string(),
  filename: z.string().min(1),
  image_base64: z.string().min(1),
  content_type: z.string().regex(/^image\//).optional(),
  caption: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  taken_at: z.string().datetime({ offset: true }).optional(),
});
const stravaIdArg = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).transform(String);
const listStravaArgs = z.object({
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  only_missing: z.boolean().optional(),
  max_pages: z.number().int().min(1).max(50).optional(),
});
const importStravaArgs = z.object({
  strava_id: stravaIdArg,
  title: z.string().min(1).optional(),
  trip_type: z.array(z.string()).optional(),
  include_photos: z.boolean().optional(),
});
const importStravaPhotosArgs = z.object({ strava_id: stravaIdArg, project_id: z.string() });
const getProjectArgs = z.object({ project_id: z.string() });
const reprocessClipArgs = z.object({ clip_id: z.string() });
const moveClipArgs = z.object({
  clip_id: z.string(),
  start_seconds: z.number().min(0).optional(),
  recorded_at: z.string().datetime({ offset: true }).optional(),
});
const listProjectsArgs = z.object({ search: z.string().optional(), has_videos: z.boolean().optional() });
const requestUploadArgs = z.object({ content_type: z.string().optional() });
const createProjectArgs = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  gpx: z.string().optional(),
  gpx_object_path: z.string().optional(),
  gpx_filename: z.string().optional(),
  trip_type: z.array(z.string()).optional(),
});
const setRouteArgs = z.object({
  project_id: z.string(),
  gpx: z.string().optional(),
  gpx_object_path: z.string().optional(),
  gpx_filename: z.string().optional(),
});
const addClipArgs = z.object({
  project_id: z.string(),
  object_path: z.string(),
  filename: z.string().min(1),
  duration_seconds: z.number().positive(),
  title: z.string().optional(),
  recorded_at: z.string().datetime({ offset: true }).optional(),
  start_seconds: z.number().min(0).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  file_size_bytes: z.number().optional(),
});

function summarizeTrip(trip: FieldNote, counts?: { photoCount: number; videoCount: number }) {
  return {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    trip_type: trip.tripType,
    date: trip.date,
    route_start: routeStartOf(trip)?.toISOString() ?? null,
    route_duration_seconds: tripDurationSeconds(trip),
    distance_miles: trip.distance,
    elevation_gain_feet: trip.elevationGain,
    ...(counts ? { photo_count: counts.photoCount, video_count: counts.videoCount } : {}),
    created_at: trip.createdAt,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function readUploadedText(objectPath: string): Promise<string> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) > MAX_GPX_BYTES) {
    throw new ToolError("GPX file is larger than 25 MB.");
  }
  const [contents] = await file.download();
  return contents.toString("utf-8");
}

async function ownedTrip(id: string, userId: string | undefined): Promise<FieldNote> {
  const trip = await storage.getFieldNoteById(id);
  if (!trip || !userId || trip.userId !== userId) throw new ToolError("Trip not found.");
  return trip;
}

function requireUser(userId: string | undefined): string {
  if (!userId) throw new ToolError("Sign in to use this tool.");
  return userId;
}

async function strava<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StravaImportError) throw new ToolError(error.message);
    throw error;
  }
}

async function callTool(name: string, args: unknown, userId?: string): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      const { search, has_videos } = listProjectsArgs.parse(args ?? {});
      const owner = requireUser(userId);
      const trips = (await storage.getFieldNotes({ search, sortOrder: "recent" })).filter((trip) => trip.userId === owner);
      const counts = await storage.getTripMediaCounts(trips.map((trip) => trip.id));
      return trips
        .filter((trip) => !has_videos || (counts.get(trip.id)?.videoCount ?? 0) > 0)
        .map((trip) => summarizeTrip(trip, counts.get(trip.id)));
    }
    case "get_project": {
      const { project_id } = getProjectArgs.parse(args);
      const trip = await ownedTrip(project_id, userId);
      const clips = await storage.getVideoClipsByTripId(project_id);
      return {
        ...summarizeTrip(trip),
        clips: clips.map((clip) => ({
          id: clip.id,
          title: clip.title,
          filename: clip.filename,
          start_seconds: clip.startTime,
          end_seconds: clip.endTime,
          processing_status: clip.processingStatus,
          processing_error: clip.processingError,
          processing_active: isVideoProcessingActive(clip.id),
        })),
      };
    }
    case "request_upload": {
      requestUploadArgs.parse(args ?? {});
      const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
      return {
        upload_url: uploadUrl,
        object_path: objectStorageService.normalizeObjectEntityPath(uploadUrl),
        method: "PUT",
        expires_in_seconds: UPLOAD_URL_TTL_SECONDS,
      };
    }
    case "create_project": {
      const input = createProjectArgs.parse(args);
      if (!input.gpx === !input.gpx_object_path) {
        throw new ToolError("Pass exactly one of gpx or gpx_object_path.");
      }
      const gpxContent = input.gpx ?? (await readUploadedText(input.gpx_object_path!));
      if (Buffer.byteLength(gpxContent) > MAX_GPX_BYTES) {
        throw new ToolError("GPX file is larger than 25 MB.");
      }
      const owner = requireUser(userId);
      let trip;
      try {
        trip = await createTripFromGpx({
          userId: owner,
          title: input.title,
          description: input.description,
          tripType: input.trip_type,
          gpxContent,
          filename: input.gpx_filename,
        });
      } catch (error) {
        throw new ToolError(`Could not read the GPX: ${error instanceof Error ? error.message : String(error)}`);
      }
      return summarizeTrip(trip);
    }
    case "set_route": {
      const input = setRouteArgs.parse(args);
      if (!input.gpx === !input.gpx_object_path) {
        throw new ToolError("Pass exactly one of gpx or gpx_object_path.");
      }
      const trip = await ownedTrip(input.project_id, userId);
      const gpxContent = input.gpx ?? (await readUploadedText(input.gpx_object_path!));
      if (Buffer.byteLength(gpxContent) > MAX_GPX_BYTES) {
        throw new ToolError("GPX file is larger than 25 MB.");
      }
      let updated;
      try {
        updated = await replaceTripRoute(trip, gpxContent, input.gpx_filename);
      } catch (error) {
        throw new ToolError(`Could not read the GPX: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!updated) throw new ToolError("The GPX has no timestamped track points.");
      return summarizeTrip(updated);
    }
    case "reprocess_clip": {
      const { clip_id } = reprocessClipArgs.parse(args);
      const clip = await storage.getVideoClipById(clip_id);
      if (!clip?.fieldNoteId) throw new ToolError("Clip not found.");
      await ownedTrip(clip.fieldNoteId, userId);
      const result = await reprocessVideoClip(clip_id);
      if (result === "not_found") throw new ToolError("Clip not found.");
      if (result === "already_active") throw new ToolError("This clip is already processing or waiting its turn.");
      return { clip_id, processing_status: "pending" };
    }
    case "move_clip": {
      const input = moveClipArgs.parse(args);
      const clip = await storage.getVideoClipById(input.clip_id);
      if (!clip?.fieldNoteId) throw new ToolError("Clip not found.");
      const trip = await ownedTrip(clip.fieldNoteId, userId);
      let startSeconds = input.start_seconds;
      if (startSeconds === undefined && input.recorded_at) {
        startSeconds = clipOffsetSeconds(new Date(input.recorded_at), routeStartOf(trip)) ?? undefined;
        if (startSeconds === undefined) {
          throw new ToolError("recorded_at is before the route starts or more than two days after it.");
        }
      }
      if (startSeconds === undefined) throw new ToolError("Pass start_seconds or recorded_at.");
      const length = clip.endTime - clip.startTime;
      const coords = resolveClipCoordinates(
        trip.gpxData,
        startSeconds,
        startSeconds + length,
        tripDurationSeconds(trip) ?? undefined,
      );
      const moved = await storage.updateVideoClip(clip.id, {
        startTime: startSeconds,
        endTime: startSeconds + length,
        ...coords,
      });
      if (!moved) throw new ToolError("Clip not found.");
      return {
        id: moved.id,
        title: moved.title,
        start_seconds: moved.startTime,
        end_seconds: moved.endTime,
        start_latitude: moved.startLatitude,
        start_longitude: moved.startLongitude,
      };
    }
    case "add_clip": {
      const input = addClipArgs.parse(args);
      const trip = await ownedTrip(input.project_id, userId);

      let startSeconds = input.start_seconds;
      if (startSeconds === undefined && input.recorded_at) {
        const offset = clipOffsetSeconds(new Date(input.recorded_at), routeStartOf(trip));
        if (offset === null) {
          throw new ToolError("recorded_at is before the route starts or more than two days after it.");
        }
        startSeconds = offset;
      }
      if (startSeconds === undefined) {
        throw new ToolError("Pass recorded_at or start_seconds to place the clip.");
      }

      if (!(await objectStorageService.verifyObjectExists(input.object_path))) {
        throw new ToolError("No uploaded file at object_path. PUT the file to upload_url first.");
      }

      const duration = Math.round(input.duration_seconds * 1000) / 1000;
      const clip = await createClipWithCoordinates({
        fieldNoteId: trip.id,
        title: input.title ?? input.filename.replace(/\.[^/.]+$/, ""),
        filename: input.filename,
        url: input.object_path,
        startTime: startSeconds,
        endTime: startSeconds + duration,
        duration,
        color: input.color ?? "#3b82f6",
        fileSize: input.file_size_bytes ? formatFileSize(input.file_size_bytes) : undefined,
        videoFormat: input.filename.split(".").pop()?.toUpperCase() || "MP4",
      });
      return {
        id: clip.id,
        title: clip.title,
        start_seconds: clip.startTime,
        end_seconds: clip.endTime,
        start_latitude: clip.startLatitude,
        start_longitude: clip.startLongitude,
        processing_status: clip.processingStatus,
      };
    }
    case "list_strava_activities": {
      const input = listStravaArgs.parse(args ?? {});
      return strava(() => listStravaActivities(requireUser(userId), {
        after: input.after ? new Date(input.after) : undefined,
        before: input.before ? new Date(input.before) : undefined,
        onlyMissing: input.only_missing,
        maxPages: input.max_pages,
      }));
    }
    case "import_strava_activity": {
      const input = importStravaArgs.parse(args);
      const { trip, photos } = await strava(() => importStravaActivity(requireUser(userId), input.strava_id, {
        title: input.title,
        tripType: input.trip_type,
        includePhotos: input.include_photos,
      }));
      return { ...summarizeTrip(trip), photos };
    }
    case "import_strava_photos": {
      const input = importStravaPhotosArgs.parse(args);
      const trip = await ownedTrip(input.project_id, userId);
      return strava(() => importStravaPhotos(requireUser(userId), input.strava_id, trip.id));
    }
    case "add_photo": {
      const input = addPhotoArgs.parse(args);
      const trip = await ownedTrip(input.project_id, userId);
      const bytes = Buffer.from(input.image_base64, "base64");
      if (!bytes.length) throw new ToolError("image_base64 is empty.");
      return strava(() => addPhotoToTrip({
        tripId: trip.id,
        filename: input.filename,
        bytes,
        contentType: input.content_type,
        caption: input.caption,
        latitude: input.latitude,
        longitude: input.longitude,
        takenAt: input.taken_at ? new Date(input.taken_at) : undefined,
      }));
    }
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
}

export async function handleRpc(message: JsonRpcRequest, userId?: string): Promise<object | null> {
  const respond = (result: unknown) => ({ jsonrpc: "2.0", id: message.id ?? null, result });
  const fail = (code: number, text: string) => ({ jsonrpc: "2.0", id: message.id ?? null, error: { code, message: text } });

  // Notifications (no id) get no response.
  const isNotification = message.id === undefined;

  switch (message.method) {
    case "initialize": {
      const requested = message.params?.protocolVersion;
      return respond({
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "big-miles", version: "1.0.0" },
        instructions:
          "Big Miles trips with video. To build one: create_project with the GPX (it makes a trip), then for each " +
          "video call request_upload, PUT the file to upload_url, and call add_clip with its object_path. " +
          "Clips process one at a time; if one fails or is stuck, call reprocess_clip. To bring in Strava rides, " +
          "list_strava_activities with only_missing, then import_strava_activity for each one the user approves.",
      });
    }
    case "ping":
      return respond({});
    case "tools/list":
      return respond({ tools });
    case "tools/call": {
      const name = message.params?.name;
      try {
        const result = await callTool(name, message.params?.arguments, userId);
        return respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        const text =
          error instanceof z.ZodError
            ? `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
            : error instanceof ToolError
              ? error.message
              : "The tool failed on the server.";
        if (!(error instanceof ToolError) && !(error instanceof z.ZodError)) {
          console.error(`MCP tool ${name} failed:`, error);
        }
        return respond({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

export function registerMcpRoutes(app: Express) {
  app.post("/mcp", requireAuth, async (req: Request & { dbUser?: { id: string } }, res: Response) => {
    const body = req.body;
    const messages: JsonRpcRequest[] = Array.isArray(body) ? body : [body];
    if (messages.length === 0 || messages.some((m) => !m || m.jsonrpc !== "2.0" || typeof m.method !== "string")) {
      return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }

    const responses = (await Promise.all(messages.map((m) => handleRpc(m, req.dbUser?.id)))).filter(Boolean);
    if (responses.length === 0) {
      return res.status(202).end();
    }
    res.json(Array.isArray(body) ? responses : responses[0]);
  });

  // This server has no server-initiated stream.
  app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
  app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
}
