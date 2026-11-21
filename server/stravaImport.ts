import { storage } from "./storage";
import { objectStorageService } from "./objectStorage";
import { buildGpxFromActivity, stravaFetch } from "./strava";
import { inboxTripGpxData, timedTripFields } from "./tripTimestamps";
import { matchStravaActivity } from "./stravaMatch";
import { extractExifFromBuffer } from "./exif-extractor";
import { parseGpxData } from "@shared/gpx-utils";
import { MAX_TRIP_PHOTOS } from "@shared/photo-limit";
import type { FieldNote } from "@shared/schema";

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;
const ACTIVITIES_PER_PAGE = 200; // Strava's maximum

export class StravaImportError extends Error {}

interface StravaActivityListItem {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  total_photo_count?: number;
  map?: { summary_polyline?: string | null };
}

export interface StravaPhoto {
  unique_id?: string;
  urls?: Record<string, string>;
  caption?: string | null;
  location?: [number, number] | null;
  created_at?: string | null;
  video_url?: string | null;
}

/** The trip type Big Miles uses for a Strava sport, the same mapping as the web and iOS inbox. */
export function tripTypeForStravaSport(sportType: string): string {
  const s = sportType.toLowerCase();
  if (s.includes("run")) return "running";
  if (s.includes("ride") || s.includes("bike") || s.includes("cycl")) return "cycling";
  if (s.includes("hike") || s.includes("walk")) return "hiking";
  if (s.includes("ski")) return "skiing";
  if (s.includes("swim")) return "openwater";
  if (["kayak", "canoe", "paddl", "row"].some((k) => s.includes(k))) return "paddling";
  if (s.includes("climb")) return "climbing";
  if (s.includes("motor")) return "motorcycle";
  return "other";
}

/**
 * The trip that already holds a Strava activity: one linked to it by id, or
 * else one that is the same outing by date and distance (trips made from
 * Apple Health or a GPX aren't linked). Each trip is matched at most once.
 */
export function findExistingTrips(
  activities: StravaActivityListItem[],
  trips: Pick<FieldNote, "id" | "title" | "date" | "distance" | "stravaId" | "stravaSource">[],
): Map<number, { tripId: string; title: string; by: "strava_id" | "date_and_distance" }> {
  const result = new Map<number, { tripId: string; title: string; by: "strava_id" | "date_and_distance" }>();
  const claimed = new Set<string>();
  const byStravaId = new Map(
    trips.filter((t) => t.stravaId && t.stravaSource !== "strava-route").map((t) => [t.stravaId!, t]),
  );
  for (const activity of activities) {
    const linked = byStravaId.get(String(activity.id));
    if (linked) {
      result.set(activity.id, { tripId: linked.id, title: linked.title, by: "strava_id" });
      claimed.add(linked.id);
    }
  }
  for (const trip of trips) {
    if (claimed.has(trip.id)) continue;
    const open = activities.filter((a) => !result.has(a.id));
    const match = matchStravaActivity({ date: new Date(trip.date), distanceMiles: trip.distance }, open);
    if (match) {
      result.set(match.id, { tripId: trip.id, title: trip.title, by: "date_and_distance" });
      claimed.add(trip.id);
    }
  }
  return result;
}

async function stravaJson<T>(userId: string, path: string): Promise<T> {
  const resp = await stravaFetch(userId, path);
  if (resp.status === 429) throw new StravaImportError("Strava's rate limit was hit. Try again in 15 minutes.");
  if (resp.status === 401) throw new StravaImportError("Strava refused the request. Reconnect Strava in the app.");
  if (!resp.ok) throw new StravaImportError(`Strava answered ${resp.status} for ${path.split("?")[0]}.`);
  return (await resp.json()) as T;
}

function wrapNotConnected<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err) => {
    if (err instanceof Error && /not connected/i.test(err.message)) {
      throw new StravaImportError("Strava isn't connected. Connect it from the app's Inbox first.");
    }
    throw err;
  });
}

/** Strava activities in a time range, each flagged with the trip that already holds it. */
export async function listStravaActivities(
  userId: string,
  options: { after?: Date; before?: Date; onlyMissing?: boolean; maxPages?: number },
) {
  return wrapNotConnected((async () => {
    const activities: StravaActivityListItem[] = [];
    const maxPages = options.maxPages ?? 10;
    let page = 1;
    for (; page <= maxPages; page += 1) {
      const params = new URLSearchParams({ per_page: String(ACTIVITIES_PER_PAGE), page: String(page) });
      if (options.after) params.set("after", String(Math.floor(options.after.getTime() / 1000)));
      if (options.before) params.set("before", String(Math.floor(options.before.getTime() / 1000)));
      const batch = await stravaJson<StravaActivityListItem[]>(userId, `/athlete/activities?${params}`);
      activities.push(...batch);
      if (batch.length < ACTIVITIES_PER_PAGE) break;
    }
    activities.sort((a, b) => b.start_date.localeCompare(a.start_date));
    const trips = (await storage.getFieldNotes({ sortOrder: "recent" })).filter((t) => t.userId === userId);
    const existing = findExistingTrips(activities, trips);
    const rows = activities.map((a) => {
      const trip = existing.get(a.id);
      return {
        strava_id: String(a.id),
        name: a.name,
        sport_type: a.sport_type,
        start_date: a.start_date,
        distance_miles: Math.round((a.distance / METERS_PER_MILE) * 10) / 10,
        moving_minutes: a.moving_time ? Math.round(a.moving_time / 60) : null,
        elevation_gain_feet: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain * FEET_PER_METER) : null,
        photo_count: a.total_photo_count ?? 0,
        has_gps: !!a.map?.summary_polyline,
        trip_id: trip?.tripId ?? null,
        trip_title: trip?.title ?? null,
        matched_by: trip?.by ?? null,
      };
    });
    return {
      total: rows.length,
      missing: rows.filter((r) => !r.trip_id).length,
      more_pages: page > maxPages,
      activities: options.onlyMissing ? rows.filter((r) => !r.trip_id) : rows,
    };
  })());
}

/** The full-size image of each Strava photo, skipping videos. */
export function photoDownloads(photos: StravaPhoto[]): { url: string; photo: StravaPhoto }[] {
  return photos
    .filter((p) => !p.video_url && p.urls)
    .map((p) => {
      const sizes = Object.keys(p.urls!).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
      return { url: sizes.length ? p.urls![String(sizes[0])] : Object.values(p.urls!)[0], photo: p };
    })
    .filter((d) => !!d.url && !/placeholder/i.test(d.url));
}

async function storeImage(bytes: Buffer, contentType: string): Promise<string> {
  const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
  if (!put.ok) throw new Error(`storage upload failed: ${put.status}`);
  return objectStorageService.normalizeObjectEntityPath(uploadUrl);
}

const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/**
 * Adds one photo to a trip from its bytes, for photos that come from outside
 * Strava such as the Mac's Photos library. EXIF wins over the given location
 * and time. A filename already on the trip is skipped, so a retry is safe.
 */
export async function addPhotoToTrip(params: {
  tripId: string;
  filename: string;
  bytes: Buffer;
  contentType?: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
  takenAt?: Date;
}): Promise<{ status: "added" | "already_on_trip" | "trip_full"; photo_id?: string }> {
  if (params.bytes.length > MAX_PHOTO_BYTES) throw new StravaImportError("Photo is larger than 30 MB.");
  const existing = (await storage.getPhotosByFieldNoteId(params.tripId)).find((p) => p.filename === params.filename);
  if (existing) return { status: "already_on_trip", photo_id: existing.id };
  const objectPath = await storeImage(params.bytes, params.contentType ?? "image/jpeg");
  const exif = await extractExifFromBuffer(params.bytes, params.filename).catch(() => ({}) as Awaited<ReturnType<typeof extractExifFromBuffer>>);
  const created = await storage.createPhotoWithinLimit({
    fieldNoteId: params.tripId,
    filename: params.filename,
    url: objectPath,
    altText: params.caption || null,
    ...exif,
    latitude: exif.latitude ?? params.latitude ?? null,
    longitude: exif.longitude ?? params.longitude ?? null,
    timestamp: exif.timestamp ?? params.takenAt ?? null,
    fileSize: exif.fileSize ?? `${(params.bytes.length / 1024 ** 2).toFixed(1)} MB`,
  });
  return created ? { status: "added", photo_id: created.id } : { status: "trip_full" };
}

/** Copies an activity's Strava photos into a trip. Returns how many were added and why any were skipped. */
export async function importStravaPhotos(userId: string, stravaId: string, tripId: string) {
  return wrapNotConnected((async () => {
    const photos = await stravaJson<StravaPhoto[]>(
      userId,
      `/activities/${stravaId}/photos?size=2048&photo_sources=true`,
    );
    const already = (await storage.getPhotosByFieldNoteId(tripId)).map((p) => p.filename);
    let added = 0;
    const skipped: string[] = [];
    const downloads = photoDownloads(photos);
    for (let i = 0; i < downloads.length; i += 1) {
      const { url, photo } = downloads[i];
      const filename = `strava_${stravaId}_${photo.unique_id ?? i + 1}.jpg`;
      if (already.includes(filename)) continue;
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
        const bytes = Buffer.from(await resp.arrayBuffer());
        const contentType = resp.headers.get("content-type") ?? "image/jpeg";
        const objectPath = await storeImage(bytes, contentType);
        const exif = await extractExifFromBuffer(bytes, filename).catch(() => ({}) as Awaited<ReturnType<typeof extractExifFromBuffer>>);
        const [lat, lng] = photo.location ?? [];
        const created = await storage.createPhotoWithinLimit({
          fieldNoteId: tripId,
          filename,
          url: objectPath,
          altText: photo.caption || null,
          ...exif,
          latitude: exif.latitude ?? lat ?? null,
          longitude: exif.longitude ?? lng ?? null,
          timestamp: exif.timestamp ?? (photo.created_at ? new Date(photo.created_at) : null),
          fileSize: exif.fileSize ?? `${(bytes.length / 1024 ** 2).toFixed(1)} MB`,
        });
        if (!created) {
          skipped.push(`trip already has ${MAX_TRIP_PHOTOS} photos`);
          break;
        }
        added += 1;
      } catch (err) {
        skipped.push(`${filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { on_strava: photos.length, added, skipped };
  })());
}

/** Makes a trip from a Strava activity, with its timed track and its Strava photos. */
export async function importStravaActivity(
  userId: string,
  stravaId: string,
  options: { title?: string; tripType?: string[]; includePhotos?: boolean },
) {
  return wrapNotConnected((async () => {
    const trips = (await storage.getFieldNotes({ sortOrder: "recent" })).filter((t) => t.userId === userId);
    const linked = trips.find((t) => t.stravaId === stravaId && t.stravaSource !== "strava-route");
    if (linked) throw new StravaImportError(`Already a trip: "${linked.title}" (${linked.id}).`);

    const activity = await stravaJson<StravaActivityListItem & { description?: string | null }>(
      userId,
      `/activities/${stravaId}`,
    );
    const streams = await stravaJson<Parameters<typeof buildGpxFromActivity>[1]>(
      userId,
      `/activities/${stravaId}/streams?keys=latlng,altitude,time&key_by_type=true`,
    );
    if (!streams.latlng?.data?.length) throw new StravaImportError("This activity has no GPS track.");

    const rawGpx = buildGpxFromActivity(activity, streams);
    const stats = parseGpxData(rawGpx);
    const { timedTrack, startTime, endTime } = timedTripFields(rawGpx);
    const safeName = activity.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
    const gpxData = inboxTripGpxData(stats, timedTrack);
    const trip = await storage.createFieldNote({
      userId,
      title: options.title ?? activity.name,
      description: activity.description ?? "",
      tripType: options.tripType ?? [tripTypeForStravaSport(activity.sport_type)],
      date: startTime ?? new Date(activity.start_date),
      distance: Math.round(stats.distance * 10) / 10,
      elevationGain: Math.round(stats.elevationGain),
      gpxData: gpxData ? { ...gpxData, filename: `strava_activity_${safeName}_${stravaId}.gpx` } : null,
      startTime,
      endTime,
      stravaId,
      stravaSource: "strava-activity",
    });

    const photos = options.includePhotos === false
      ? null
      : await importStravaPhotos(userId, stravaId, trip.id).catch((err) => ({
          on_strava: null,
          added: 0,
          skipped: [err instanceof Error ? err.message : String(err)],
        }));
    return { trip, photos };
  })());
}
