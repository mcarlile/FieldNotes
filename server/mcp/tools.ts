import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { storage } from "../storage";
import { parseGpxData } from "@shared/gpx-utils";
import { buildGpxXml, type TrackPoint } from "./gpx-builder";

const MAX_TRACK_POINTS = 5000;

const TrackSchema = z.object({
  name: z.string().max(200).optional().default("Track"),
  points: z
    .array(
      z.tuple([
        z.number().min(-90).max(90).describe("Latitude"),
        z.number().min(-180).max(180).describe("Longitude"),
        z.number().nullable().describe("Elevation in metres, or null"),
        z.string().nullable().describe("ISO 8601 timestamp, or null"),
      ])
    )
    .min(2)
    .max(MAX_TRACK_POINTS)
    .describe(`GPS track points (max ${MAX_TRACK_POINTS})`),
});

type TrackInput = z.infer<typeof TrackSchema>;

function processTrack(track: TrackInput): {
  gpxData: { coordinates: [number, number][]; elevationProfile: any[] };
  distance: number;
  elevationGain: number;
  gpxXml: string;
} {
  const points = track.points as TrackPoint[];
  const gpxXml = buildGpxXml(track.name ?? "Track", points);
  const parsed = parseGpxData(gpxXml);
  return {
    gpxXml,
    gpxData: {
      coordinates: parsed.coordinates,
      elevationProfile: parsed.elevationProfile,
    },
    distance: parsed.distance,           // miles
    elevationGain: parsed.elevationGain, // feet
  };
}

function ok(obj: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function err(msg: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({ name: "FieldNotes", version: "1.0.0" });

  // ── create_field_note ──────────────────────────────────────────────────────
  server.tool(
    "create_field_note",
    `Create a new field note (trip log entry) for an outdoor activity.
Use this when the user wants to record a hike, bike ride, run, backpacking trip, or
any other outdoor outing. Supply a GPS track when available — the server will compute
distance, elevation gain, and duration automatically from the track points.
Returns the new entry's ID and URL.`,
    {
      title: z
        .string()
        .min(1)
        .max(200)
        .describe('Short title, e.g. "Summit Attempt — Mount Whitney"'),
      date: z
        .string()
        .describe("Date of the activity in ISO 8601 format, e.g. '2024-07-15'"),
      description: z
        .string()
        .optional()
        .default("")
        .describe("Optional longer narrative or journal entry"),
      trip_type: z
        .array(z.string())
        .optional()
        .default(["hiking"])
        .describe(
          "Activity type(s). One or more of: hiking, cycling, running, backpacking, " +
          "paddling, fishing, motorcycle, climbing, skiing, openwater, other"
        ),
      track: TrackSchema.optional().describe(
        "Optional GPS track. Points are [lat, lon, elevation_m, iso_timestamp]; " +
        "elevation and timestamp may be null. Max 5000 points."
      ),
    },
    async (args) => {
      try {
        let gpxData: any = undefined;
        let distance: number | undefined;
        let elevationGain: number | undefined;

        if (args.track) {
          const t = processTrack(args.track as TrackInput);
          gpxData = t.gpxData;
          distance = t.distance;
          elevationGain = t.elevationGain;
        }

        const fieldNote = await storage.createFieldNote({
          title: args.title,
          description: args.description ?? "",
          tripType: args.trip_type ?? ["hiking"],
          date: new Date(args.date),
          userId,
          ...(gpxData !== undefined && { gpxData }),
          ...(distance !== undefined && { distance }),
          ...(elevationGain !== undefined && { elevationGain }),
        });

        return ok({
          id: fieldNote.id,
          title: fieldNote.title,
          date: fieldNote.date,
          distance: fieldNote.distance,
          elevationGain: fieldNote.elevationGain,
          url: `/field-notes/${fieldNote.id}`,
        });
      } catch (e: any) {
        return err(`Failed to create field note: ${e.message}`);
      }
    }
  );

  // ── list_field_notes ───────────────────────────────────────────────────────
  server.tool(
    "list_field_notes",
    `List the user's field notes, newest first.
Use this to browse existing entries before deciding to create or update one.
Returns title, date, distance, elevation gain, and ID for each note.`,
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of results (1–100, default 20)"),
      since: z
        .string()
        .optional()
        .describe(
          "Return only entries on or after this ISO 8601 date, e.g. '2024-01-01'"
        ),
    },
    async (args) => {
      try {
        let notes = await storage.getFieldNotes({ sortOrder: "recent" });

        // ownership filter
        notes = notes.filter((n) => n.userId === userId || n.userId == null);

        if (args.since) {
          const cutoff = new Date(args.since);
          notes = notes.filter((n) => new Date(n.date) >= cutoff);
        }

        notes = notes.slice(0, args.limit ?? 20);

        const rows = notes.map((n) => ({
          id: n.id,
          title: n.title,
          date: n.date,
          tripType: n.tripType,
          distance: n.distance ?? null,
          elevationGain: n.elevationGain ?? null,
          isPublished: n.isPublished,
          url: `/field-notes/${n.id}`,
        }));

        return ok({ count: rows.length, notes: rows });
      } catch (e: any) {
        return err(`Failed to list field notes: ${e.message}`);
      }
    }
  );

  // ── update_field_note ──────────────────────────────────────────────────────
  server.tool(
    "update_field_note",
    `Update metadata on an existing field note.
Use this to correct a title, change the date, or update the description.
Does not replace the GPS track — use attach_track for that.
Returns the updated entry.`,
    {
      id: z.string().describe("ID of the field note to update"),
      title: z.string().min(1).max(200).optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      date: z.string().optional().describe("New date in ISO 8601 format"),
      trip_type: z
        .array(z.string())
        .optional()
        .describe("New activity type(s)"),
    },
    async (args) => {
      try {
        const existing = await storage.getFieldNoteById(args.id);
        if (!existing) return err(`Field note '${args.id}' not found`);
        if (existing.userId && existing.userId !== userId)
          return err("Not authorised to update this field note");

        const updates: Record<string, any> = {};
        if (args.title !== undefined) updates.title = args.title;
        if (args.description !== undefined) updates.description = args.description;
        if (args.date !== undefined) updates.date = new Date(args.date);
        if (args.trip_type !== undefined) updates.tripType = args.trip_type;

        if (Object.keys(updates).length === 0)
          return err("No fields to update — supply at least one of: title, description, date, trip_type");

        const updated = await storage.updateFieldNote(args.id, updates);
        if (!updated) return err(`Update failed for field note '${args.id}'`);

        return ok({
          id: updated.id,
          title: updated.title,
          date: updated.date,
          url: `/field-notes/${updated.id}`,
        });
      } catch (e: any) {
        return err(`Failed to update field note: ${e.message}`);
      }
    }
  );

  // ── attach_track ───────────────────────────────────────────────────────────
  server.tool(
    "attach_track",
    `Attach or replace the GPS track on an existing field note.
Use this when a field note was created without a track and one becomes available,
or to replace a previously attached track with a better recording.
The server recomputes distance, elevation gain, and the elevation profile from
the new track points.
Returns updated distance and elevation gain.`,
    {
      id: z.string().describe("ID of the field note"),
      track: TrackSchema.describe(
        "GPS track data. Points are [lat, lon, elevation_m, iso_timestamp]; " +
        "elevation and timestamp may be null."
      ),
    },
    async (args) => {
      try {
        const existing = await storage.getFieldNoteById(args.id);
        if (!existing) return err(`Field note '${args.id}' not found`);
        if (existing.userId && existing.userId !== userId)
          return err("Not authorised to modify this field note");

        const t = processTrack(args.track as TrackInput);

        const updated = await storage.updateFieldNote(args.id, {
          gpxData: t.gpxData,
          distance: t.distance,
          elevationGain: t.elevationGain,
        });
        if (!updated) return err(`Update failed for field note '${args.id}'`);

        return ok({
          id: updated.id,
          distance: updated.distance,
          elevationGain: updated.elevationGain,
          url: `/field-notes/${updated.id}`,
        });
      } catch (e: any) {
        return err(`Failed to attach track: ${e.message}`);
      }
    }
  );

  return server;
}
