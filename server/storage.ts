import { fieldNotes, photos, trailcamProjects, videoClips, webhookTokens, gpxInbox, stravaConnections, expeditions, expeditionFieldNotes, type TripPlayback, type FieldNote, type Photo, type InsertFieldNote, type InsertPhoto, type TrailcamProject, type VideoClip, type InsertTrailcamProject, type InsertVideoClip, type WebhookToken, type GpxInboxItem, type StravaConnection, type InsertStravaConnection, type Expedition, type InsertExpedition, type ExpeditionFieldNote } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, like, ilike, and, or, sql, inArray, getTableColumns } from "drizzle-orm";
import { MAX_TRIP_PHOTOS } from "@shared/photo-limit";
import { existingPhotoCaptionPatch } from "./photo-caption";

export interface ApiTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

function toApiTokenSummary(row: any): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: new Date(row.created_at),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
  };
}

export interface TripMediaCounts {
  photoCount: number;
  videoCount: number;
}

export interface FieldNoteListOptions {
  search?: string;
  tripType?: string;
  sortOrder?: 'recent' | 'oldest' | 'name';
  /** Only this user's trips. */
  userId?: string;
  /**
   * Read only the route's coordinates from gpxData, not the timed track or
   * elevation profile, for lists that only draw the route.
   */
  routeOnly?: boolean;
}

export interface IStorage {
  // Field Notes
  getFieldNotes(options?: FieldNoteListOptions): Promise<FieldNote[]>;
  getFieldNoteById(id: string): Promise<FieldNote | undefined>;
  createFieldNote(fieldNote: InsertFieldNote): Promise<FieldNote>;
  updateFieldNote(id: string, fieldNote: Partial<InsertFieldNote>): Promise<FieldNote | undefined>;
  deleteFieldNote(id: string): Promise<boolean>;
  getTripMediaCounts(ids: string[]): Promise<Map<string, TripMediaCounts>>;
  updateTripPlayback(id: string, patch: TripPlayback): Promise<FieldNote | undefined>;

  // Photos
  getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]>;
  getPhotoById(id: string): Promise<Photo | undefined>;
  createPhoto(photo: InsertPhoto): Promise<Photo>;
  createPhotoWithinLimit(photo: InsertPhoto): Promise<Photo | undefined>;
  updatePhoto(id: string, photo: Partial<InsertPhoto>): Promise<Photo | undefined>;
  deletePhoto(id: string): Promise<boolean>;
  updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]>;

  // TrailCam Projects
  getTrailcamProjects(options?: {
    search?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  }): Promise<TrailcamProject[]>;
  getTrailcamProjectById(id: string): Promise<TrailcamProject | undefined>;
  createTrailcamProject(project: InsertTrailcamProject): Promise<TrailcamProject>;
  updateTrailcamProject(id: string, project: Partial<InsertTrailcamProject>): Promise<TrailcamProject | undefined>;
  deleteTrailcamProject(id: string): Promise<boolean>;

  // Video Clips
  getVideoClipsByTripId(tripId: string): Promise<VideoClip[]>;
  getVideoClipById(id: string): Promise<VideoClip | undefined>;
  createVideoClip(clip: InsertVideoClip): Promise<VideoClip>;
  updateVideoClip(id: string, clip: Partial<InsertVideoClip>): Promise<VideoClip | undefined>;
  deleteVideoClip(id: string): Promise<boolean>;
  getInterruptedVideoClips(): Promise<VideoClip[]>;

  // Webhook Tokens
  getWebhookTokenByUserId(userId: string): Promise<WebhookToken | undefined>;
  getWebhookTokenByToken(token: string): Promise<WebhookToken | undefined>;
  upsertWebhookToken(userId: string, token: string): Promise<WebhookToken>;

  // GPX Inbox
  getInboxItems(userId: string): Promise<GpxInboxItem[]>;
  getInboxItemById(id: string): Promise<GpxInboxItem | undefined>;
  getInboxItemByStravaId(userId: string, source: string, stravaId: string): Promise<GpxInboxItem | undefined>;
  createInboxItem(item: { userId: string; filename: string; rawGpx: string; gpxStats?: any; sourceIp?: string; source?: string; stravaId?: string }): Promise<GpxInboxItem>;
  updateInboxItemStatus(id: string, status: string): Promise<GpxInboxItem | undefined>;
  deleteInboxItem(id: string): Promise<boolean>;

  // Strava connections
  getStravaConnection(userId: string): Promise<StravaConnection | undefined>;
  upsertStravaConnection(data: InsertStravaConnection): Promise<StravaConnection>;
  updateStravaTokens(userId: string, accessToken: string, refreshToken: string, expiresAt: number): Promise<void>;
  deleteStravaConnection(userId: string): Promise<void>;

  // Mobile tokens
  getMobileToken(token: string): Promise<{ userId: string; expiresAt: Date } | undefined>;
  createMobileToken(userId: string, token: string, expiresAt: Date): Promise<void>;
  deleteMobileTokensByUser(userId: string): Promise<void>;

  // Personal API tokens
  createApiToken(userId: string, name: string, tokenHash: string, tokenPrefix: string): Promise<ApiTokenSummary>;
  listApiTokens(userId: string): Promise<ApiTokenSummary[]>;
  deleteApiToken(userId: string, id: string): Promise<boolean>;

  // Publishing — field notes
  publishFieldNote(id: string, slug: string): Promise<FieldNote | undefined>;
  unpublishFieldNote(id: string): Promise<FieldNote | undefined>;
  getPublishedFieldNoteBySlug(slug: string): Promise<FieldNote | undefined>;

  // Expeditions
  getExpeditionsByUser(userId: string): Promise<Expedition[]>;
  getExpeditionById(id: string): Promise<Expedition | undefined>;
  createExpedition(data: InsertExpedition): Promise<Expedition>;
  updateExpedition(id: string, data: Partial<InsertExpedition>): Promise<Expedition | undefined>;
  deleteExpedition(id: string): Promise<boolean>;
  publishExpedition(id: string, slug: string): Promise<Expedition | undefined>;
  unpublishExpedition(id: string): Promise<Expedition | undefined>;
  getPublishedExpeditionBySlug(slug: string): Promise<Expedition | undefined>;
  setExpeditionFieldNotes(expeditionId: string, fieldNoteIds: string[]): Promise<void>;
  getExpeditionFieldNotes(expeditionId: string): Promise<Array<{ fieldNote: FieldNote; position: number }>>;
}

export class DatabaseStorage implements IStorage {
  async getFieldNotes(options: FieldNoteListOptions = {}): Promise<FieldNote[]> {
    // Raw GPX XML is stored as a JSON string; that stays whole for the caller to parse.
    const gpxData = options.routeOnly
      ? sql<unknown>`CASE WHEN jsonb_typeof(${fieldNotes.gpxData}) = 'object'
          THEN jsonb_build_object('coordinates', ${fieldNotes.gpxData}->'coordinates')
          ELSE ${fieldNotes.gpxData} END`
      : fieldNotes.gpxData;
    let query = db.select({ ...getTableColumns(fieldNotes), gpxData }).from(fieldNotes);

    const conditions = [];

    if (options.userId) {
      conditions.push(eq(fieldNotes.userId, options.userId));
    }

    if (options.search) {
      const searchTerm = options.search.trim();
      if (searchTerm) {
        conditions.push(
          or(
            ilike(fieldNotes.title, `%${searchTerm}%`),
            ilike(fieldNotes.description, `%${searchTerm}%`),
            sql`EXISTS (SELECT 1 FROM unnest(${fieldNotes.tripType}) AS t WHERE lower(t) LIKE ${`%${searchTerm.toLowerCase()}%`})`
          )
        );
      }
    }

    if (options.tripType) {
      conditions.push(sql`${fieldNotes.tripType} @> ARRAY[${options.tripType}]::text[]`);
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        query = query.orderBy(asc(fieldNotes.date)) as typeof query;
        break;
      case 'name':
        query = query.orderBy(asc(fieldNotes.title)) as typeof query;
        break;
      case 'recent':
      default:
        query = query.orderBy(desc(fieldNotes.date)) as typeof query;
        break;
    }

    return await query;
  }

  async getFieldNoteById(id: string): Promise<FieldNote | undefined> {
    const [fieldNote] = await db.select().from(fieldNotes).where(eq(fieldNotes.id, id));
    return fieldNote || undefined;
  }

  async createFieldNote(insertFieldNote: InsertFieldNote): Promise<FieldNote> {
    const [fieldNote] = await db
      .insert(fieldNotes)
      .values(insertFieldNote)
      .returning();
    return fieldNote;
  }

  async updateFieldNote(id: string, updateFieldNote: Partial<InsertFieldNote>): Promise<FieldNote | undefined> {
    const [fieldNote] = await db
      .update(fieldNotes)
      .set(updateFieldNote)
      .where(eq(fieldNotes.id, id))
      .returning();
    return fieldNote || undefined;
  }

  async deleteFieldNote(id: string): Promise<boolean> {
    // First delete all associated photos
    await db.delete(photos).where(eq(photos.fieldNoteId, id));

    // Then delete the field note
    const result = await db.delete(fieldNotes).where(eq(fieldNotes.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getTripMediaCounts(ids: string[]): Promise<Map<string, TripMediaCounts>> {
    const counts = new Map<string, TripMediaCounts>(ids.map((id) => [id, { photoCount: 0, videoCount: 0 }]));
    if (ids.length === 0) return counts;
    const [photoRows, clipRows] = await Promise.all([
      db.select({ id: photos.fieldNoteId, total: sql<number>`count(*)::int` })
        .from(photos).where(inArray(photos.fieldNoteId, ids)).groupBy(photos.fieldNoteId),
      db.select({ id: videoClips.fieldNoteId, total: sql<number>`count(*)::int` })
        .from(videoClips).where(inArray(videoClips.fieldNoteId, ids)).groupBy(videoClips.fieldNoteId),
    ]);
    for (const row of photoRows) {
      const entry = counts.get(row.id);
      if (entry) entry.photoCount = row.total;
    }
    for (const row of clipRows) {
      const entry = row.id ? counts.get(row.id) : undefined;
      if (entry) entry.videoCount = row.total;
    }
    return counts;
  }

  async updateTripPlayback(id: string, patch: TripPlayback): Promise<FieldNote | undefined> {
    return db.transaction(async (tx) => {
      const [note] = await tx.select().from(fieldNotes).where(eq(fieldNotes.id, id)).for("update");
      if (!note) return undefined;
      const playback = { ...((note.playback as TripPlayback | null) ?? {}), ...patch };
      const [updated] = await tx.update(fieldNotes).set({ playback }).where(eq(fieldNotes.id, id)).returning();
      return updated;
    });
  }

  async getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]> {
    return await db.select().from(photos).where(eq(photos.fieldNoteId, fieldNoteId));
  }

  async getPhotoById(id: string): Promise<Photo | undefined> {
    const [photo] = await db.select().from(photos).where(eq(photos.id, id));
    return photo || undefined;
  }

  async createPhoto(insertPhoto: InsertPhoto): Promise<Photo> {
    const [photo] = await db
      .insert(photos)
      .values(insertPhoto)
      .returning();
    return photo;
  }

  async createPhotoWithinLimit(insertPhoto: InsertPhoto): Promise<Photo | undefined> {
    return db.transaction(async (tx) => {
      // Lock the parent row: simultaneous direct photo POSTs for this trip
      // serialize their count-and-insert without a schema migration.
      const [note] = await tx.select({ id: fieldNotes.id })
        .from(fieldNotes).where(eq(fieldNotes.id, insertPhoto.fieldNoteId)).for("update");
      if (!note) return undefined;
      const [count] = await tx.select({ total: sql<number>`count(*)::int` })
        .from(photos).where(eq(photos.fieldNoteId, insertPhoto.fieldNoteId));
      if (count.total >= MAX_TRIP_PHOTOS) return undefined;
      const [photo] = await tx.insert(photos).values(insertPhoto).returning();
      return photo;
    });
  }

  async updatePhoto(id: string, updatePhoto: Partial<InsertPhoto>): Promise<Photo | undefined> {
    const [photo] = await db
      .update(photos)
      .set(updatePhoto)
      .where(eq(photos.id, id))
      .returning();
    return photo || undefined;
  }

  async deletePhoto(id: string): Promise<boolean> {
    const result = await db.delete(photos).where(eq(photos.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]> {
    return db.transaction(async (tx) => {
      // Same parent-row lock as createPhotoWithinLimit; bulk replacements and
      // direct photo POSTs cannot race one another past the cap.
      await tx.select({ id: fieldNotes.id })
        .from(fieldNotes).where(eq(fieldNotes.id, fieldNoteId)).for("update");
      const existingPhotos = await tx.select().from(photos).where(eq(photos.fieldNoteId, fieldNoteId));
      const existingPhotoIds = new Set(existingPhotos.map(p => p.id));
      const keepPhotoIds = new Set<string>();

      for (const photoData of photosData) {
        if (photoData.id && existingPhotoIds.has(photoData.id)) {
          keepPhotoIds.add(photoData.id);
          const captionPatch = existingPhotoCaptionPatch(photoData);
          if (captionPatch) {
            await tx.update(photos).set(captionPatch)
              .where(and(eq(photos.id, photoData.id), eq(photos.fieldNoteId, fieldNoteId)));
          }
        } else if (!photoData.id && photoData.url && photoData.filename) {
          await tx.insert(photos).values({
            fieldNoteId,
            filename: photoData.filename,
            url: photoData.url,
            altText: photoData.caption || '',
            latitude: photoData.latitude ?? null,
            longitude: photoData.longitude ?? null,
            elevation: photoData.elevation ?? null,
            timestamp: photoData.timestamp ? new Date(photoData.timestamp) : null,
            camera: photoData.camera || null,
            lens: photoData.lens || null,
            aperture: photoData.aperture || null,
            shutterSpeed: photoData.shutterSpeed || null,
            iso: photoData.iso ?? null,
            focalLength: photoData.focalLength || null,
            fileSize: photoData.fileSize || null,
          });
        }
      }
      for (const existingPhoto of existingPhotos) {
        if (!keepPhotoIds.has(existingPhoto.id)) {
          await tx.delete(photos).where(eq(photos.id, existingPhoto.id));
        }
      }
      return tx.select().from(photos).where(eq(photos.fieldNoteId, fieldNoteId));
    });
  }

  // TrailCam Projects
  async getTrailcamProjects(options: {
    search?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  } = {}): Promise<TrailcamProject[]> {
    let query = db.select().from(trailcamProjects);

    const conditions = [];

    if (options.search) {
      const searchTerm = options.search.trim();
      if (searchTerm) {
        conditions.push(
          or(
            ilike(trailcamProjects.title, `%${searchTerm}%`),
            ilike(trailcamProjects.description, `%${searchTerm}%`)
          )
        );
      }
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        query = query.orderBy(asc(trailcamProjects.createdAt)) as typeof query;
        break;
      case 'name':
        query = query.orderBy(asc(trailcamProjects.title)) as typeof query;
        break;
      case 'recent':
      default:
        query = query.orderBy(desc(trailcamProjects.createdAt)) as typeof query;
        break;
    }

    return await query;
  }

  async getTrailcamProjectById(id: string): Promise<TrailcamProject | undefined> {
    const [project] = await db.select().from(trailcamProjects).where(eq(trailcamProjects.id, id));
    return project || undefined;
  }

  async createTrailcamProject(insertProject: InsertTrailcamProject): Promise<TrailcamProject> {
    const [project] = await db
      .insert(trailcamProjects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateTrailcamProject(id: string, updateProject: Partial<InsertTrailcamProject>): Promise<TrailcamProject | undefined> {
    const [project] = await db
      .update(trailcamProjects)
      .set(updateProject)
      .where(eq(trailcamProjects.id, id))
      .returning();
    return project || undefined;
  }

  async deleteTrailcamProject(id: string): Promise<boolean> {
    // First delete all associated video clips
    await db.delete(videoClips).where(eq(videoClips.projectId, id));

    // Then delete the project
    const result = await db.delete(trailcamProjects).where(eq(trailcamProjects.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Video Clips
  async getVideoClipsByTripId(tripId: string): Promise<VideoClip[]> {
    return await db.select().from(videoClips).where(eq(videoClips.fieldNoteId, tripId)).orderBy(asc(videoClips.startTime));
  }

  async getVideoClipById(id: string): Promise<VideoClip | undefined> {
    const [clip] = await db.select().from(videoClips).where(eq(videoClips.id, id));
    return clip || undefined;
  }

  async createVideoClip(insertClip: InsertVideoClip): Promise<VideoClip> {
    const [clip] = await db
      .insert(videoClips)
      .values(insertClip)
      .returning();
    return clip;
  }

  async updateVideoClip(id: string, updateClip: Partial<InsertVideoClip>): Promise<VideoClip | undefined> {
    const [clip] = await db
      .update(videoClips)
      .set(updateClip)
      .where(eq(videoClips.id, id))
      .returning();
    return clip || undefined;
  }

  async deleteVideoClip(id: string): Promise<boolean> {
    const result = await db.delete(videoClips).where(eq(videoClips.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getInterruptedVideoClips(): Promise<VideoClip[]> {
    return db
      .select()
      .from(videoClips)
      .where(inArray(videoClips.processingStatus, ['pending', 'processing']));
  }

  // Webhook Tokens
  async getWebhookTokenByUserId(userId: string): Promise<WebhookToken | undefined> {
    const [row] = await db.select().from(webhookTokens).where(eq(webhookTokens.userId, userId));
    return row;
  }

  async getWebhookTokenByToken(token: string): Promise<WebhookToken | undefined> {
    const [row] = await db.select().from(webhookTokens).where(eq(webhookTokens.token, token));
    return row;
  }

  async upsertWebhookToken(userId: string, token: string): Promise<WebhookToken> {
    const [row] = await db
      .insert(webhookTokens)
      .values({ userId, token })
      .onConflictDoUpdate({
        target: webhookTokens.userId,
        set: { token, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  // GPX Inbox
  async getInboxItems(userId: string): Promise<GpxInboxItem[]> {
    return db
      .select()
      .from(gpxInbox)
      .where(eq(gpxInbox.userId, userId))
      .orderBy(desc(gpxInbox.receivedAt));
  }

  async getInboxItemById(id: string): Promise<GpxInboxItem | undefined> {
    const [row] = await db.select().from(gpxInbox).where(eq(gpxInbox.id, id));
    return row;
  }

  async getInboxItemByStravaId(userId: string, source: string, stravaId: string): Promise<GpxInboxItem | undefined> {
    const { and, eq } = await import("drizzle-orm");
    const [row] = await db.select().from(gpxInbox)
      .where(and(
        eq(gpxInbox.userId, userId),
        eq(gpxInbox.source, source),
        eq(gpxInbox.stravaId, stravaId),
      ));
    return row;
  }

  async createInboxItem(item: { userId: string; filename: string; rawGpx: string; gpxStats?: any; sourceIp?: string; source?: string; stravaId?: string }): Promise<GpxInboxItem> {
    const [row] = await db.insert(gpxInbox).values({
      userId: item.userId,
      filename: item.filename,
      rawGpx: item.rawGpx,
      gpxStats: item.gpxStats ?? null,
      sourceIp: item.sourceIp ?? null,
      source: item.source ?? null,
      stravaId: item.stravaId ?? null,
      status: 'pending',
    }).returning();
    return row;
  }

  async updateInboxItemStatus(id: string, status: string): Promise<GpxInboxItem | undefined> {
    const [row] = await db
      .update(gpxInbox)
      .set({ status })
      .where(eq(gpxInbox.id, id))
      .returning();
    return row;
  }

  async deleteInboxItem(id: string): Promise<boolean> {
    const result = await db.delete(gpxInbox).where(eq(gpxInbox.id, id)).returning();
    return result.length > 0;
  }

  // Strava connections
  async getStravaConnection(userId: string): Promise<StravaConnection | undefined> {
    const [row] = await db.select().from(stravaConnections).where(eq(stravaConnections.userId, userId));
    return row;
  }

  async upsertStravaConnection(data: InsertStravaConnection): Promise<StravaConnection> {
    const [row] = await db
      .insert(stravaConnections)
      .values(data)
      .onConflictDoUpdate({
        target: stravaConnections.userId,
        set: {
          stravaAthleteId: data.stravaAthleteId,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          scope: data.scope,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async updateStravaTokens(userId: string, accessToken: string, refreshToken: string, expiresAt: number): Promise<void> {
    await db.update(stravaConnections)
      .set({ accessToken, refreshToken, expiresAt, updatedAt: new Date() })
      .where(eq(stravaConnections.userId, userId));
  }

  async deleteStravaConnection(userId: string): Promise<void> {
    await db.delete(stravaConnections).where(eq(stravaConnections.userId, userId));
  }

  // Mobile tokens — raw SQL since this table isn't in Drizzle schema
  async getMobileToken(token: string): Promise<{ userId: string; expiresAt: Date } | undefined> {
    const { pool } = await import("./db");
    const result = await pool.query(
      "SELECT user_id, expires_at FROM mobile_tokens WHERE token = $1",
      [token]
    );
    if (!result.rows[0]) return undefined;
    return { userId: result.rows[0].user_id, expiresAt: new Date(result.rows[0].expires_at) };
  }

  async createMobileToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    const { pool } = await import("./db");
    await pool.query(
      "INSERT INTO mobile_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token) DO NOTHING",
      [userId, token, expiresAt]
    );
  }

  async deleteMobileTokensByUser(userId: string): Promise<void> {
    const { pool } = await import("./db");
    await pool.query("DELETE FROM mobile_tokens WHERE user_id = $1", [userId]);
  }

  // Personal API tokens — raw SQL like mobile tokens; only hashes are stored
  async createApiToken(userId: string, name: string, tokenHash: string, tokenPrefix: string): Promise<ApiTokenSummary> {
    const { pool } = await import("./db");
    const result = await pool.query(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix) VALUES ($1, $2, $3, $4)
       RETURNING id, name, token_prefix, created_at, last_used_at`,
      [userId, name, tokenHash, tokenPrefix]
    );
    return toApiTokenSummary(result.rows[0]);
  }

  async listApiTokens(userId: string): Promise<ApiTokenSummary[]> {
    const { pool } = await import("./db");
    const result = await pool.query(
      `SELECT id, name, token_prefix, created_at, last_used_at FROM api_tokens
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(toApiTokenSummary);
  }

  async deleteApiToken(userId: string, id: string): Promise<boolean> {
    const { pool } = await import("./db");
    const result = await pool.query("DELETE FROM api_tokens WHERE user_id = $1 AND id = $2", [userId, id]);
    return (result.rowCount ?? 0) > 0;
  }

  // Publishing — field notes
  async publishFieldNote(id: string, slug: string): Promise<FieldNote | undefined> {
    const [note] = await db
      .update(fieldNotes)
      .set({ isPublished: true, publishedAt: new Date(), slug })
      .where(eq(fieldNotes.id, id))
      .returning();
    return note;
  }

  async unpublishFieldNote(id: string): Promise<FieldNote | undefined> {
    const [note] = await db
      .update(fieldNotes)
      .set({ isPublished: false })
      .where(eq(fieldNotes.id, id))
      .returning();
    return note;
  }

  async getPublishedFieldNoteBySlug(slug: string): Promise<FieldNote | undefined> {
    const [note] = await db
      .select()
      .from(fieldNotes)
      .where(and(eq(fieldNotes.slug, slug), eq(fieldNotes.isPublished, true)));
    return note;
  }

  // Expeditions
  async getExpeditionsByUser(userId: string): Promise<Expedition[]> {
    return db
      .select()
      .from(expeditions)
      .where(eq(expeditions.userId, userId))
      .orderBy(desc(expeditions.createdAt));
  }

  async getExpeditionById(id: string): Promise<Expedition | undefined> {
    const [exp] = await db.select().from(expeditions).where(eq(expeditions.id, id));
    return exp;
  }

  async createExpedition(data: InsertExpedition): Promise<Expedition> {
    const [exp] = await db.insert(expeditions).values(data).returning();
    return exp;
  }

  async updateExpedition(id: string, data: Partial<InsertExpedition>): Promise<Expedition | undefined> {
    const [exp] = await db
      .update(expeditions)
      .set(data)
      .where(eq(expeditions.id, id))
      .returning();
    return exp;
  }

  async deleteExpedition(id: string): Promise<boolean> {
    const result = await db.delete(expeditions).where(eq(expeditions.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async publishExpedition(id: string, slug: string): Promise<Expedition | undefined> {
    const [exp] = await db
      .update(expeditions)
      .set({ isPublished: true, publishedAt: new Date(), slug })
      .where(eq(expeditions.id, id))
      .returning();
    return exp;
  }

  async unpublishExpedition(id: string): Promise<Expedition | undefined> {
    const [exp] = await db
      .update(expeditions)
      .set({ isPublished: false })
      .where(eq(expeditions.id, id))
      .returning();
    return exp;
  }

  async getPublishedExpeditionBySlug(slug: string): Promise<Expedition | undefined> {
    const [exp] = await db
      .select()
      .from(expeditions)
      .where(and(eq(expeditions.slug, slug), eq(expeditions.isPublished, true)));
    return exp;
  }

  async setExpeditionFieldNotes(expeditionId: string, fieldNoteIds: string[]): Promise<void> {
    await db.delete(expeditionFieldNotes).where(eq(expeditionFieldNotes.expeditionId, expeditionId));
    if (fieldNoteIds.length === 0) return;
    await db.insert(expeditionFieldNotes).values(
      fieldNoteIds.map((fieldNoteId, position) => ({ expeditionId, fieldNoteId, position }))
    );
  }

  async getExpeditionFieldNotes(expeditionId: string): Promise<Array<{ fieldNote: FieldNote; position: number }>> {
    const rows = await db
      .select({ fieldNote: fieldNotes, position: expeditionFieldNotes.position })
      .from(expeditionFieldNotes)
      .innerJoin(fieldNotes, eq(expeditionFieldNotes.fieldNoteId, fieldNotes.id))
      .where(eq(expeditionFieldNotes.expeditionId, expeditionId))
      .orderBy(asc(expeditionFieldNotes.position));
    return rows;
  }
}

// Temporary in-memory storage with sample data for demonstration
export class MemStorage implements IStorage {
  async updateFieldNote(id: string, updateFieldNote: Partial<InsertFieldNote>): Promise<FieldNote | undefined> {
    const index = this.fieldNotesData.findIndex(note => note.id === id);
    if (index === -1) return undefined;

    this.fieldNotesData[index] = { ...this.fieldNotesData[index], ...updateFieldNote };
    return this.fieldNotesData[index];
  }

  async deleteFieldNote(id: string): Promise<boolean> {
    const index = this.fieldNotesData.findIndex(note => note.id === id);
    if (index === -1) return false;

    // Delete associated photos
    this.photosData = this.photosData.filter(photo => photo.fieldNoteId !== id);
    // Delete field note
    this.fieldNotesData.splice(index, 1);
    return true;
  }

  async updatePhoto(id: string, updatePhoto: Partial<InsertPhoto>): Promise<Photo | undefined> {
    const index = this.photosData.findIndex(photo => photo.id === id);
    if (index === -1) return undefined;

    this.photosData[index] = { ...this.photosData[index], ...updatePhoto };
    return this.photosData[index];
  }
  private fieldNotesData: FieldNote[] = [
    {
      id: "1",
      userId: null,
      title: "Mount Whitney Summit Trail",
      description: "A challenging 22-mile round trip hike to the highest peak in the contiguous United States. The trail offers stunning alpine scenery, crystal-clear mountain lakes, and breathtaking views from the summit at 14,505 feet.",
      tripType: ["Hiking"],
      date: new Date("2024-07-15T06:00:00Z"),
      distance: 22.0,
      elevationGain: 6100,
      gpxData: {
        coordinates: [
          [-118.292, 36.578],
          [-118.291, 36.579],
          [-118.290, 36.580],
          [-118.289, 36.581],
          [-118.288, 36.582]
        ]
      },
      stravaId: null,
      stravaSource: null,
      isPublished: false,
      publishedAt: null,
      slug: null,
      startTime: null,
      endTime: null,
      playback: null,
      createdAt: new Date("2024-07-16T10:00:00Z")
    },
    {
      id: "2",
      userId: null,
      title: "Yosemite Valley Loop",
      description: "A scenic bike ride through the iconic Yosemite Valley, passing by El Capitan, Bridalveil Fall, and Half Dome. Perfect for families and offering incredible photographic opportunities.",
      tripType: ["Cycling"],
      date: new Date("2024-06-20T08:30:00Z"),
      distance: 12.5,
      elevationGain: 200,
      gpxData: {
        coordinates: [
          [-119.651, 37.748],
          [-119.650, 37.749],
          [-119.649, 37.750],
          [-119.648, 37.751]
        ]
      },
      stravaId: null,
      stravaSource: null,
      isPublished: false,
      publishedAt: null,
      slug: null,
      startTime: null,
      endTime: null,
      playback: null,
      createdAt: new Date("2024-06-21T09:15:00Z")
    }
  ];

  private photosData: Photo[] = [
    {
      id: "1",
      fieldNoteId: "1",
      filename: "whitney-summit.jpg",
      altText: "",
      latitude: 36.578,
      longitude: -118.292,
      elevation: 14505,
      url: "https://example.com/photos/whitney-summit.jpg",
      timestamp: new Date("2024-07-15T14:30:00Z"),
      camera: "Canon EOS R5",
      lens: "RF 24-70mm f/2.8",
      focalLength: "35mm",
      aperture: "f/8",
      shutterSpeed: "1/250",
      iso: 100,
      fileSize: "2.4 MB",
      createdAt: new Date("2024-07-16T10:05:00Z")
    },
    {
      id: "2",
      fieldNoteId: "1",
      filename: "alpine-lake.jpg",
      altText: "",
      latitude: 36.580,
      longitude: -118.290,
      elevation: 12000,
      url: "https://example.com/photos/alpine-lake.jpg",
      timestamp: new Date("2024-07-15T11:45:00Z"),
      camera: "Canon EOS R5",
      lens: "RF 16-35mm f/2.8",
      focalLength: "24mm",
      aperture: "f/11",
      shutterSpeed: "1/125",
      iso: 200,
      fileSize: "3.1 MB",
      createdAt: new Date("2024-07-16T10:06:00Z")
    },
    {
      id: "3",
      fieldNoteId: "2",
      filename: "el-capitan.jpg",
      altText: "",
      latitude: 37.748,
      longitude: -119.651,
      elevation: 4000,
      url: "https://example.com/photos/el-capitan.jpg",
      timestamp: new Date("2024-06-20T10:15:00Z"),
      camera: "Sony A7IV",
      lens: "24-70mm f/2.8",
      focalLength: "50mm",
      aperture: "f/5.6",
      shutterSpeed: "1/200",
      iso: 100,
      fileSize: "1.8 MB",
      createdAt: new Date("2024-06-21T09:20:00Z")
    }
  ];

  async getFieldNotes(options: FieldNoteListOptions = {}): Promise<FieldNote[]> {
    let filtered = this.fieldNotesData.filter(note => !options.userId || note.userId === options.userId);

    if (options.search) {
      const searchLower = options.search.toLowerCase().trim();
      if (searchLower) {
        filtered = filtered.filter(note =>
          note.title.toLowerCase().includes(searchLower) ||
          note.description.toLowerCase().includes(searchLower) ||
          note.tripType.some(t => t.toLowerCase().includes(searchLower))
        );
      }
    }

    if (options.tripType) {
      filtered = filtered.filter(note => note.tripType.includes(options.tripType!));
    }

    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        filtered.sort((a, b) => a.date.getTime() - b.date.getTime());
        break;
      case 'name':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        filtered.sort((a, b) => b.date.getTime() - a.date.getTime());
        break;
    }

    return filtered;
  }

  async getFieldNoteById(id: string): Promise<FieldNote | undefined> {
    return this.fieldNotesData.find(note => note.id === id);
  }

  async createFieldNote(insertFieldNote: InsertFieldNote): Promise<FieldNote> {
    const fieldNote: FieldNote = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertFieldNote,
      userId: insertFieldNote.userId ?? null,
      distance: insertFieldNote.distance ?? null,
      elevationGain: insertFieldNote.elevationGain ?? null,
      gpxData: insertFieldNote.gpxData ?? null,
      stravaId: insertFieldNote.stravaId ?? null,
      stravaSource: insertFieldNote.stravaSource ?? null,
      isPublished: false,
      publishedAt: null,
      slug: null,
      startTime: insertFieldNote.startTime ?? null,
      endTime: insertFieldNote.endTime ?? null,
      playback: insertFieldNote.playback ?? null,
      createdAt: new Date()
    };
    this.fieldNotesData.push(fieldNote);
    return fieldNote;
  }

  async getTripMediaCounts(ids: string[]): Promise<Map<string, TripMediaCounts>> {
    return new Map(ids.map((id) => [id, {
      photoCount: this.photosData.filter(photo => photo.fieldNoteId === id).length,
      videoCount: this.videoClipsData.filter(clip => clip.fieldNoteId === id).length,
    }]));
  }

  async updateTripPlayback(id: string, patch: TripPlayback): Promise<FieldNote | undefined> {
    const note = this.fieldNotesData.find(n => n.id === id);
    if (!note) return undefined;
    note.playback = { ...((note.playback as TripPlayback | null) ?? {}), ...patch };
    return note;
  }

  async getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]> {
    return this.photosData.filter(photo => photo.fieldNoteId === fieldNoteId);
  }

  async getPhotoById(id: string): Promise<Photo | undefined> {
    return this.photosData.find(photo => photo.id === id);
  }

  async createPhoto(insertPhoto: InsertPhoto): Promise<Photo> {
    const photo: Photo = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertPhoto,
      altText: insertPhoto.altText ?? null,
      latitude: insertPhoto.latitude ?? null,
      longitude: insertPhoto.longitude ?? null,
      elevation: insertPhoto.elevation ?? null,
      timestamp: insertPhoto.timestamp ?? null,
      camera: insertPhoto.camera ?? null,
      lens: insertPhoto.lens ?? null,
      aperture: insertPhoto.aperture ?? null,
      shutterSpeed: insertPhoto.shutterSpeed ?? null,
      iso: insertPhoto.iso ?? null,
      focalLength: insertPhoto.focalLength ?? null,
      fileSize: insertPhoto.fileSize ?? null,
      createdAt: new Date()
    };
    this.photosData.push(photo);
    return photo;
  }

  async createPhotoWithinLimit(insertPhoto: InsertPhoto): Promise<Photo | undefined> {
    if (!this.fieldNotesData.some(note => note.id === insertPhoto.fieldNoteId) ||
        this.photosData.filter(photo => photo.fieldNoteId === insertPhoto.fieldNoteId).length >= MAX_TRIP_PHOTOS) {
      return undefined;
    }
    return this.createPhoto(insertPhoto);
  }

  async deletePhoto(id: string): Promise<boolean> {
    const index = this.photosData.findIndex(photo => photo.id === id);
    if (index !== -1) {
      this.photosData.splice(index, 1);
      return true;
    }
    return false;
  }

  async updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]> {
    // MemStorage is a non-production stub, but existing caption edits should
    // have the same non-destructive behavior as DatabaseStorage.
    for (const photoData of photosData) {
      const photo = this.photosData.find(p => p.id === photoData.id && p.fieldNoteId === fieldNoteId);
      const captionPatch = existingPhotoCaptionPatch(photoData);
      if (photo && captionPatch) Object.assign(photo, captionPatch);
    }
    return this.photosData.filter(photo => photo.fieldNoteId === fieldNoteId);
  }

  // TrailCam Projects - stub implementations for MemStorage
  private trailcamProjectsData: TrailcamProject[] = [];
  private videoClipsData: VideoClip[] = [];

  async getTrailcamProjects(options: {
    search?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  } = {}): Promise<TrailcamProject[]> {
    let filtered = [...this.trailcamProjectsData];

    if (options.search) {
      const searchLower = options.search.toLowerCase().trim();
      if (searchLower) {
        filtered = filtered.filter(project =>
          project.title.toLowerCase().includes(searchLower) ||
          (project.description && project.description.toLowerCase().includes(searchLower))
        );
      }
    }

    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        break;
      case 'name':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;
    }

    return filtered;
  }

  async getTrailcamProjectById(id: string): Promise<TrailcamProject | undefined> {
    return this.trailcamProjectsData.find(project => project.id === id);
  }

  async createTrailcamProject(insertProject: InsertTrailcamProject): Promise<TrailcamProject> {
    const project: TrailcamProject = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertProject,
      description: insertProject.description ?? null,
      duration: insertProject.duration ?? null,
      startTime: insertProject.startTime ?? null,
      endTime: insertProject.endTime ?? null,
      migratedAt: insertProject.migratedAt ?? null,
      createdAt: new Date()
    };
    this.trailcamProjectsData.push(project);
    return project;
  }

  async updateTrailcamProject(id: string, updateProject: Partial<InsertTrailcamProject>): Promise<TrailcamProject | undefined> {
    const index = this.trailcamProjectsData.findIndex(project => project.id === id);
    if (index === -1) return undefined;

    this.trailcamProjectsData[index] = { ...this.trailcamProjectsData[index], ...updateProject };
    return this.trailcamProjectsData[index];
  }

  async deleteTrailcamProject(id: string): Promise<boolean> {
    const index = this.trailcamProjectsData.findIndex(project => project.id === id);
    if (index === -1) return false;

    // Delete associated video clips
    this.videoClipsData = this.videoClipsData.filter(clip => clip.projectId !== id);
    // Delete project
    this.trailcamProjectsData.splice(index, 1);
    return true;
  }

  // Video Clips
  async getVideoClipsByTripId(tripId: string): Promise<VideoClip[]> {
    return this.videoClipsData
      .filter(clip => clip.fieldNoteId === tripId)
      .sort((a, b) => a.startTime - b.startTime);
  }

  async getVideoClipById(id: string): Promise<VideoClip | undefined> {
    return this.videoClipsData.find(clip => clip.id === id);
  }

  async createVideoClip(insertClip: InsertVideoClip): Promise<VideoClip> {
    const clip: VideoClip = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertClip,
      transcodedUrl: insertClip.transcodedUrl ?? null,
      thumbnailUrl: insertClip.thumbnailUrl ?? null,
      processingStatus: insertClip.processingStatus ?? "pending",
      processingError: insertClip.processingError ?? null,
      startLatitude: insertClip.startLatitude ?? null,
      startLongitude: insertClip.startLongitude ?? null,
      endLatitude: insertClip.endLatitude ?? null,
      endLongitude: insertClip.endLongitude ?? null,
      color: insertClip.color ?? null,
      fileSize: insertClip.fileSize ?? null,
      videoFormat: insertClip.videoFormat ?? null,
      projectId: insertClip.projectId ?? null,
      fieldNoteId: insertClip.fieldNoteId ?? null,
      createdAt: new Date()
    };
    this.videoClipsData.push(clip);
    return clip;
  }

  async updateVideoClip(id: string, updateClip: Partial<InsertVideoClip>): Promise<VideoClip | undefined> {
    const index = this.videoClipsData.findIndex(clip => clip.id === id);
    if (index === -1) return undefined;

    this.videoClipsData[index] = { ...this.videoClipsData[index], ...updateClip };
    return this.videoClipsData[index];
  }

  async deleteVideoClip(id: string): Promise<boolean> {
    const index = this.videoClipsData.findIndex(clip => clip.id === id);
    if (index !== -1) {
      this.videoClipsData.splice(index, 1);
      return true;
    }
    return false;
  }

  async getInterruptedVideoClips(): Promise<VideoClip[]> {
    return this.videoClipsData.filter(
      (clip) => clip.processingStatus === 'pending' || clip.processingStatus === 'processing',
    );
  }

  // Webhook Tokens (stubs — MemStorage not used in production)
  async getWebhookTokenByUserId(_userId: string): Promise<WebhookToken | undefined> { return undefined; }
  async getWebhookTokenByToken(_token: string): Promise<WebhookToken | undefined> { return undefined; }
  async upsertWebhookToken(_userId: string, _token: string): Promise<WebhookToken> { throw new Error("Not implemented"); }

  // GPX Inbox (stubs — MemStorage not used in production)
  async getInboxItems(_userId: string): Promise<GpxInboxItem[]> { return []; }
  async getInboxItemById(_id: string): Promise<GpxInboxItem | undefined> { return undefined; }
  async getInboxItemByStravaId(_userId: string, _source: string, _stravaId: string): Promise<GpxInboxItem | undefined> { return undefined; }
  async createInboxItem(_item: any): Promise<GpxInboxItem> { throw new Error("Not implemented"); }
  async updateInboxItemStatus(_id: string, _status: string): Promise<GpxInboxItem | undefined> { return undefined; }
  async deleteInboxItem(_id: string): Promise<boolean> { return false; }

  // Strava connections (stubs)
  async getStravaConnection(_userId: string): Promise<StravaConnection | undefined> { return undefined; }
  async upsertStravaConnection(_data: InsertStravaConnection): Promise<StravaConnection> { throw new Error("Not implemented"); }
  async updateStravaTokens(_userId: string, _accessToken: string, _refreshToken: string, _expiresAt: number): Promise<void> {}
  async deleteStravaConnection(_userId: string): Promise<void> {}

  // Mobile tokens (stubs)
  async getMobileToken(_token: string): Promise<{ userId: string; expiresAt: Date } | undefined> { return undefined; }
  async createMobileToken(_userId: string, _token: string, _expiresAt: Date): Promise<void> {}
  async deleteMobileTokensByUser(_userId: string): Promise<void> {}

  // Personal API tokens (stubs)
  async createApiToken(_userId: string, _name: string, _tokenHash: string, _tokenPrefix: string): Promise<ApiTokenSummary> { throw new Error("Not implemented"); }
  async listApiTokens(_userId: string): Promise<ApiTokenSummary[]> { return []; }
  async deleteApiToken(_userId: string, _id: string): Promise<boolean> { return false; }

  // Publishing + expeditions (stubs)
  async publishFieldNote(_id: string, _slug: string): Promise<FieldNote | undefined> { return undefined; }
  async unpublishFieldNote(_id: string): Promise<FieldNote | undefined> { return undefined; }
  async getPublishedFieldNoteBySlug(_slug: string): Promise<FieldNote | undefined> { return undefined; }
  async getExpeditionsByUser(_userId: string): Promise<Expedition[]> { return []; }
  async getExpeditionById(_id: string): Promise<Expedition | undefined> { return undefined; }
  async createExpedition(_data: InsertExpedition): Promise<Expedition> { throw new Error("Not implemented"); }
  async updateExpedition(_id: string, _data: Partial<InsertExpedition>): Promise<Expedition | undefined> { return undefined; }
  async deleteExpedition(_id: string): Promise<boolean> { return false; }
  async publishExpedition(_id: string, _slug: string): Promise<Expedition | undefined> { return undefined; }
  async unpublishExpedition(_id: string): Promise<Expedition | undefined> { return undefined; }
  async getPublishedExpeditionBySlug(_slug: string): Promise<Expedition | undefined> { return undefined; }
  async setExpeditionFieldNotes(_expeditionId: string, _fieldNoteIds: string[]): Promise<void> {}
  async getExpeditionFieldNotes(_expeditionId: string): Promise<Array<{ fieldNote: FieldNote; position: number }>> { return []; }
}

// Use database storage for permanent data persistence
export const storage = new DatabaseStorage();
