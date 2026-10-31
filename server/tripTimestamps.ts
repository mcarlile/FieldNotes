import type { PoolClient } from "pg";
import { compactTimedTrack, parseGpxData, type CompactTimedTrack, type GpxStats } from "@shared/gpx-utils";

/**
 * The parts of a trip that come from its GPX's timestamps: the compact timed
 * track (which places video clips on the route) and the start and end times.
 * Everything is null when the GPX has no times, like a planned Strava route.
 */
export function timedTripFields(rawGpx: string): {
  timedTrack: CompactTimedTrack | null;
  startTime: Date | null;
  endTime: Date | null;
} {
  let timedTrack: CompactTimedTrack | null = null;
  try {
    timedTrack = compactTimedTrack(rawGpx);
  } catch {
    // A malformed GPX still makes a trip, just without video placement.
  }
  if (!timedTrack) return { timedTrack: null, startTime: null, endTime: null };
  const startTime = new Date(timedTrack.startTime);
  return {
    timedTrack,
    startTime,
    endTime: new Date(startTime.getTime() + timedTrack.durationSeconds * 1000),
  };
}

/** gpxData for a trip made from an inbox item: the route, its elevation chart and its times. */
export function inboxTripGpxData(stats: Partial<GpxStats> | null, timedTrack: CompactTimedTrack | null) {
  if (!stats?.coordinates) return null;
  return {
    coordinates: stats.coordinates,
    elevationProfile: stats.elevationProfile ?? [],
    timedTrack,
  };
}

/**
 * Trips promoted from the GPX inbox used to keep only the route's shape, so
 * they couldn't take video. The inbox still has each Strava import's GPX, so
 * this restores the timed track (and the elevation chart, if missing) on
 * those trips. Trips it has looked at get a timedTrack key, even a null one,
 * so each is only parsed once.
 */
export async function backfillTripTimestamps(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: string; raw_gpx: string; has_profile: boolean }>(`
    SELECT DISTINCT ON (f.id) f.id, i.raw_gpx, (f.gpx_data ? 'elevationProfile') AS has_profile
    FROM field_notes f
    JOIN gpx_inbox i ON i.strava_id = f.strava_id AND i.user_id = f.user_id
    WHERE f.strava_id IS NOT NULL
      AND jsonb_typeof(f.gpx_data) = 'object'
      AND NOT (f.gpx_data ? 'timedTrack')
    ORDER BY f.id, i.received_at DESC
  `);
  let restored = 0;
  for (const row of rows) {
    const { timedTrack, startTime, endTime } = timedTripFields(row.raw_gpx);
    const patch: Record<string, unknown> = { timedTrack };
    if (!row.has_profile) {
      try {
        patch.elevationProfile = parseGpxData(row.raw_gpx).elevationProfile;
      } catch {
        // The chart is a nicety; the times are what matter here.
      }
    }
    await client.query(
      `UPDATE field_notes
         SET gpx_data = gpx_data || $2::jsonb,
             start_time = COALESCE(start_time, $3),
             end_time = COALESCE(end_time, $4)
       WHERE id = $1`,
      [row.id, JSON.stringify(patch), startTime, endTime],
    );
    if (timedTrack) restored += 1;
  }
  return restored;
}

/**
 * Start and end times for a trip saved through the field-notes API, read from
 * the gpxData it was sent with: the raw GPX text the web editor keeps, or the
 * parsed object (with its timedTrack) the iOS app sends. Without these the
 * trip has no route start, so clips can't be placed from their recording time.
 */
export function gpxDataTimes(gpxData: unknown): { startTime: Date; endTime: Date } | null {
  if (typeof gpxData === "string") {
    const { startTime, endTime } = timedTripFields(gpxData);
    return startTime && endTime ? { startTime, endTime } : null;
  }
  const timedTrack = (gpxData as { timedTrack?: { startTime?: unknown; durationSeconds?: unknown } } | null)?.timedTrack;
  if (typeof timedTrack?.startTime !== "string") return null;
  const startTime = new Date(timedTrack.startTime);
  if (isNaN(startTime.getTime())) return null;
  const duration = typeof timedTrack.durationSeconds === "number" ? timedTrack.durationSeconds : 0;
  return { startTime, endTime: new Date(startTime.getTime() + duration * 1000) };
}

/**
 * Trips whose route carries times but whose start_time was never set: the
 * raw GPX text kept by the web editor, or a timedTrack saved without one.
 * Without start_time, clip uploads can't turn a recording time into a start.
 */
export async function backfillStartTimesFromRoutes(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: string; gpx_data: unknown }>(`
    SELECT id, gpx_data FROM field_notes
    WHERE start_time IS NULL
      AND (jsonb_typeof(gpx_data) = 'string' OR gpx_data->'timedTrack' ? 'startTime')
  `);
  let restored = 0;
  for (const row of rows) {
    const times = gpxDataTimes(row.gpx_data);
    if (!times) continue;
    await client.query(
      `UPDATE field_notes SET start_time = $2, end_time = $3 WHERE id = $1 AND start_time IS NULL`,
      [row.id, times.startTime, times.endTime],
    );
    restored += 1;
  }
  return restored;
}
