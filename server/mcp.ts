import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { objectStorageService } from "./objectStorage";
import { requireAuth } from "./middlewares/clerkAuth";
import { createClipWithCoordinates, createProjectFromGpx } from "./trailcam";
import { clipOffsetSeconds } from "@shared/clip-timing";

/**
 * A small Model Context Protocol server (Streamable HTTP, stateless, JSON
 * responses) so Claude can create TrailCam projects and add clips for the
 * signed-in user. Video bytes never pass through MCP: `request_upload` hands
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
    description: "List TrailCam Studio projects, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Only projects whose title matches." },
      },
    },
  },
  {
    name: "get_project",
    description: "Get one project with its route start time and its video clips.",
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
      "Create a TrailCam Studio project from a GPX route. Pass the GPX either inline as `gpx` " +
      "or, for large files, as `gpx_object_path` from request_upload. The route's first timed " +
      "point becomes the project start.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        gpx: { type: "string", description: "GPX file contents." },
        gpx_object_path: { type: "string", description: "object_path of an uploaded GPX file." },
        gpx_filename: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "add_clip",
    description:
      "Add an uploaded video to a project. Place it with `recorded_at` (the UTC time the video " +
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
];

const getProjectArgs = z.object({ project_id: z.string() });
const listProjectsArgs = z.object({ search: z.string().optional() });
const requestUploadArgs = z.object({ content_type: z.string().optional() });
const createProjectArgs = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
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

function routeStartOf(project: { gpxData: unknown; startTime: Date | null }): Date | null {
  const timedStart = (project.gpxData as { timedTrack?: { startTime?: string } } | null)?.timedTrack?.startTime;
  if (timedStart) return new Date(timedStart);
  return project.startTime ? new Date(project.startTime) : null;
}

function summarizeProject(project: any) {
  const gpx = project.gpxData ?? {};
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    route_start: routeStartOf(project)?.toISOString() ?? null,
    route_duration_seconds: project.duration,
    distance_miles: gpx.distance,
    elevation_gain_feet: gpx.elevationGain,
    created_at: project.createdAt,
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

async function callTool(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      const { search } = listProjectsArgs.parse(args ?? {});
      const projects = await storage.getTrailcamProjects({ search, sortOrder: "recent" });
      return projects.map(summarizeProject);
    }
    case "get_project": {
      const { project_id } = getProjectArgs.parse(args);
      const project = await storage.getTrailcamProjectById(project_id);
      if (!project) throw new ToolError("Project not found.");
      const clips = await storage.getVideoClipsByProjectId(project_id);
      return {
        ...summarizeProject(project),
        clips: clips.map((clip) => ({
          id: clip.id,
          title: clip.title,
          filename: clip.filename,
          start_seconds: clip.startTime,
          end_seconds: clip.endTime,
          processing_status: clip.processingStatus,
          processing_error: clip.processingError,
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
      let project;
      try {
        project = await createProjectFromGpx({
          title: input.title,
          description: input.description,
          gpxContent,
          filename: input.gpx_filename,
        });
      } catch (error) {
        throw new ToolError(`Could not read the GPX: ${error instanceof Error ? error.message : String(error)}`);
      }
      return summarizeProject(project);
    }
    case "add_clip": {
      const input = addClipArgs.parse(args);
      const project = await storage.getTrailcamProjectById(input.project_id);
      if (!project) throw new ToolError("Project not found.");

      let startSeconds = input.start_seconds;
      if (startSeconds === undefined && input.recorded_at) {
        const offset = clipOffsetSeconds(new Date(input.recorded_at), routeStartOf(project));
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
        projectId: input.project_id,
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
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
}

async function handleRpc(message: JsonRpcRequest): Promise<object | null> {
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
          "Big Miles TrailCam Studio. To build a project: create_project with the GPX, then for each " +
          "video call request_upload, PUT the file to upload_url, and call add_clip with its object_path.",
      });
    }
    case "ping":
      return respond({});
    case "tools/list":
      return respond({ tools });
    case "tools/call": {
      const name = message.params?.name;
      try {
        const result = await callTool(name, message.params?.arguments);
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
  app.post("/mcp", requireAuth, async (req: Request, res: Response) => {
    const body = req.body;
    const messages: JsonRpcRequest[] = Array.isArray(body) ? body : [body];
    if (messages.length === 0 || messages.some((m) => !m || m.jsonrpc !== "2.0" || typeof m.method !== "string")) {
      return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
    }

    const responses = (await Promise.all(messages.map(handleRpc))).filter(Boolean);
    if (responses.length === 0) {
      return res.status(202).end();
    }
    res.json(Array.isArray(body) ? responses : responses[0]);
  });

  // This server has no server-initiated stream.
  app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
  app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
}
