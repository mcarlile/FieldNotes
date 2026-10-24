import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, real, jsonb, integer, index, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Strava OAuth connections — one per user
export const stravaConnections = pgTable("strava_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().unique(),
  stravaAthleteId: integer("strava_athlete_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: integer("expires_at"), // Unix epoch seconds
  scope: text("scope"),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StravaConnection = typeof stravaConnections.$inferSelect;
export type InsertStravaConnection = typeof stravaConnections.$inferInsert;

// Re-export Replit Auth tables (users + sessions)
export * from "./models/auth";

// Webhook tokens — one per user, used to receive GPX files via webhook
export const webhookTokens = pgTable("webhook_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().unique(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// GPX Inbox — files received via webhook endpoint or Strava import
export const gpxInbox = pgTable("gpx_inbox", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  filename: text("filename").notNull(),
  rawGpx: text("raw_gpx").notNull(),
  gpxStats: jsonb("gpx_stats"), // { distance, elevationGain, date, coordinates }
  status: text("status").notNull().default("pending"), // pending | promoted | dismissed
  source: text("source"), // null | 'webhook' | 'strava-activity' | 'strava-route'
  stravaId: text("strava_id"), // Strava activity/route ID for dedup
  sourceIp: text("source_ip"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("gpx_inbox_user_id_idx").on(table.userId),
  statusIdx: index("gpx_inbox_status_idx").on(table.status),
}));

export type WebhookToken = typeof webhookTokens.$inferSelect;
export type GpxInboxItem = typeof gpxInbox.$inferSelect;

export const fieldNotes = pgTable("field_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tripType: text("trip_type").array().notNull(),
  date: timestamp("date").notNull(),
  distance: real("distance"), // in miles
  elevationGain: real("elevation_gain"), // in meters
  gpxData: jsonb("gpx_data"), // stored GPX track data
  stravaId: text("strava_id"), // Strava activity/route ID
  stravaSource: text("strava_source"), // 'strava-activity' | 'strava-route'
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  slug: text("slug").unique(),
  // Start and end of the GPX's timed track; video clips are placed relative to startTime.
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  // Video playback settings for trips with clips (sync offset, follow-cam angle).
  playback: jsonb("playback"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("field_notes_user_id_idx").on(table.userId),
}));

export const expeditions = pgTable("expeditions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  coverPhotoUrl: text("cover_photo_url"),
  slug: text("slug").unique(),
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("expeditions_user_id_idx").on(table.userId),
}));

export const expeditionFieldNotes = pgTable("expedition_field_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  expeditionId: varchar("expedition_id").notNull().references(() => expeditions.id, { onDelete: "cascade" }),
  fieldNoteId: varchar("field_note_id").notNull().references(() => fieldNotes.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
}, (table) => ({
  uniqueIdx: uniqueIndex("expedition_field_notes_unique").on(table.expeditionId, table.fieldNoteId),
  expeditionIdx: index("expedition_field_notes_expedition_idx").on(table.expeditionId),
}));

export const photos = pgTable("photos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fieldNoteId: varchar("field_note_id").references(() => fieldNotes.id).notNull(),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  altText: text("alt_text"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  elevation: real("elevation"),
  timestamp: timestamp("timestamp"),
  camera: text("camera"),
  lens: text("lens"),
  aperture: text("aperture"),
  shutterSpeed: text("shutter_speed"),
  iso: integer("iso"),
  focalLength: text("focal_length"),
  fileSize: text("file_size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  fieldNoteIdIdx: index("photos_field_note_id_idx").on(table.fieldNoteId),
}));

export const fieldNotesRelations = relations(fieldNotes, ({ many }) => ({
  photos: many(photos),
  videoClips: many(videoClips),
  expeditionFieldNotes: many(expeditionFieldNotes),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  fieldNote: one(fieldNotes, {
    fields: [photos.fieldNoteId],
    references: [fieldNotes.id],
  }),
}));

export const expeditionsRelations = relations(expeditions, ({ many }) => ({
  expeditionFieldNotes: many(expeditionFieldNotes),
}));

export const expeditionFieldNotesRelations = relations(expeditionFieldNotes, ({ one }) => ({
  expedition: one(expeditions, {
    fields: [expeditionFieldNotes.expeditionId],
    references: [expeditions.id],
  }),
  fieldNote: one(fieldNotes, {
    fields: [expeditionFieldNotes.fieldNoteId],
    references: [fieldNotes.id],
  }),
}));

// TrailCam Studio tables
export const trailcamProjects = pgTable("trailcam_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  gpxData: jsonb("gpx_data").notNull(), // GPS route data
  duration: real("duration"), // total project duration in seconds
  startTime: timestamp("start_time"), // project start timestamp
  endTime: timestamp("end_time"), // project end timestamp
  // Set once the project has been copied into field_notes as a trip.
  migratedAt: timestamp("migrated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  titleIdx: index("trailcam_projects_title_idx").on(table.title),
}));

export const videoClips = pgTable("video_clips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Legacy TrailCam project link; clips now belong to a trip via fieldNoteId.
  projectId: varchar("project_id").references(() => trailcamProjects.id),
  fieldNoteId: varchar("field_note_id").references(() => fieldNotes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  url: text("url").notNull(), // Original high-res video URL
  transcodedUrl: text("transcoded_url"), // 1080p transcoded version URL
  thumbnailUrl: text("thumbnail_url"), // First frame thumbnail URL
  processingStatus: text("processing_status").default("pending"), // pending, processing, ready, error
  processingError: text("processing_error"), // Error message if processing failed
  startTime: real("start_time").notNull(), // offset from project start in seconds
  endTime: real("end_time").notNull(), // offset from project start in seconds
  duration: real("duration").notNull(), // clip duration in seconds
  startLatitude: real("start_latitude"), // GPS latitude at clip start
  startLongitude: real("start_longitude"), // GPS longitude at clip start
  endLatitude: real("end_latitude"), // GPS latitude at clip end
  endLongitude: real("end_longitude"), // GPS longitude at clip end
  color: text("color").default("#3b82f6"), // timeline color coding
  fileSize: text("file_size"),
  videoFormat: text("video_format"), // MP4, WebM, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index("video_clips_project_id_idx").on(table.projectId),
  fieldNoteIdIdx: index("video_clips_field_note_id_idx").on(table.fieldNoteId),
  startTimeIdx: index("video_clips_start_time_idx").on(table.startTime),
}));

export const insertFieldNoteSchema = createInsertSchema(fieldNotes).omit({
  id: true,
  createdAt: true,
}).extend({
  date: z.coerce.date(),
  // Trips moved over from TrailCam Studio have no activity type yet.
  tripType: z.array(z.string()),
  startTime: z.coerce.date().nullish(),
  endTime: z.coerce.date().nullish(),
});

export const insertPhotoSchema = createInsertSchema(photos).omit({
  id: true,
  createdAt: true,
});

// TrailCam Studio relations
export const trailcamProjectsRelations = relations(trailcamProjects, ({ many }) => ({
  videoClips: many(videoClips),
}));

export const videoClipsRelations = relations(videoClips, ({ one }) => ({
  project: one(trailcamProjects, {
    fields: [videoClips.projectId],
    references: [trailcamProjects.id],
  }),
  fieldNote: one(fieldNotes, {
    fields: [videoClips.fieldNoteId],
    references: [fieldNotes.id],
  }),
}));

// TrailCam Studio schemas
export const insertTrailcamProjectSchema = createInsertSchema(trailcamProjects).omit({
  id: true,
  createdAt: true,
}).extend({
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
});

export const insertVideoClipSchema = createInsertSchema(videoClips).omit({
  id: true,
  createdAt: true,
});

export const insertExpeditionSchema = createInsertSchema(expeditions).omit({
  id: true,
  createdAt: true,
  isPublished: true,
  publishedAt: true,
  slug: true,
});

export type InsertFieldNote = z.infer<typeof insertFieldNoteSchema>;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type InsertTrailcamProject = z.infer<typeof insertTrailcamProjectSchema>;
export type InsertVideoClip = z.infer<typeof insertVideoClipSchema>;
export type InsertExpedition = z.infer<typeof insertExpeditionSchema>;
export type FieldNote = typeof fieldNotes.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type TrailcamProject = typeof trailcamProjects.$inferSelect;
export type VideoClip = typeof videoClips.$inferSelect;
export type Expedition = typeof expeditions.$inferSelect;

/** Follow-cam angle chosen in calibrate mode. */
export interface CameraAngle {
  pitch: number;
  zoom: number;
  bearingOffset: number;
}

/** Saved on a trip's `playback` column once it has video. */
export interface TripPlayback {
  syncOffsetSeconds?: number;
  cameraAngle?: CameraAngle | null;
}

/** A trip as the list API returns it, with how many photos and videos it has. */
export type TripListItem = FieldNote & { photoCount: number; videoCount: number };
export type ExpeditionFieldNote = typeof expeditionFieldNotes.$inferSelect;
