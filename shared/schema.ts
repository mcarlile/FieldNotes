import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, real, jsonb, integer } from "drizzle-orm/pg-core";
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
});

export const fieldNotesRelations = relations(fieldNotes, ({ many }) => ({
  photos: many(photos),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  fieldNote: one(fieldNotes, {
    fields: [photos.fieldNoteId],
    references: [fieldNotes.id],
  }),
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

export type InsertFieldNote = z.infer<typeof insertFieldNoteSchema>;
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type FieldNote = typeof fieldNotes.$inferSelect;
export type Photo = typeof photos.$inferSelect;
