import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, real, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const fieldNotes = pgTable("field_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  tripType: text("trip_type").notNull(), // hiking, cycling, photography, running
  date: timestamp("date").notNull(),
  distance: real("distance"), // in kilometers
  elevationGain: real("elevation_gain"), // in meters
  gpxData: jsonb("gpx_data"), // stored GPX track data
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
}));

export const photosRelations = relations(photos, ({ one }) => ({
  fieldNote: one(fieldNotes, {
    fields: [photos.fieldNoteId],
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  titleIdx: index("trailcam_projects_title_idx").on(table.title),
}));

export const videoClips = pgTable("video_clips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => trailcamProjects.id).notNull(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  url: text("url").notNull(),
  startTime: real("start_time").notNull(), // offset from project start in seconds
  endTime: real("end_time").notNull(), // offset from project start in seconds
  duration: real("duration").notNull(), // clip duration in seconds
  color: text("color").default("#3b82f6"), // timeline color coding
  fileSize: text("file_size"),
  videoFormat: text("video_format"), // MP4, WebM, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index("video_clips_project_id_idx").on(table.projectId),
  startTimeIdx: index("video_clips_start_time_idx").on(table.startTime),
}));

export const insertFieldNoteSchema = createInsertSchema(fieldNotes).omit({
  id: true,
  createdAt: true,
}).extend({
  date: z.coerce.date(), // Allow string to date conversion
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

export type InsertFieldNote = z.infer<typeof insertFieldNoteSchema>;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type InsertTrailcamProject = z.infer<typeof insertTrailcamProjectSchema>;
export type InsertVideoClip = z.infer<typeof insertVideoClipSchema>;
export type FieldNote = typeof fieldNotes.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type TrailcamProject = typeof trailcamProjects.$inferSelect;
export type VideoClip = typeof videoClips.$inferSelect;
