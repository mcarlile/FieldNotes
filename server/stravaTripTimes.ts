import type { Pool } from "pg";
import { buildGpxFromActivity, stravaFetch } from "./strava";
import { timedTripFields } from "./tripTimestamps";
import { matchStravaActivity, type StravaActivitySummary } from "./stravaMatch";

// Strava allows 100 requests per 15 minutes; one every 10 s stays under it.
const REQUEST_GAP_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function stravaJson<T>(userId: string, path: string): Promise<T | null> {
  await sleep(REQUEST_GAP_MS);
  const resp = await stravaFetch(userId, path);
  return resp.ok ? ((await resp.json()) as T) : null;
}

/**
 * Gives route times to trips that have none by reading them from Strava: the
 * linked activity when there is one, otherwise a matching activity. Each trip
 * is tried once (marked with timesCheckedOnStrava). Runs in the background,
 * since it waits on Strava.
 */
export async function restoreTripTimesFromStrava(pool: Pool): Promise<{ restored: number; checked: number }> {
  const { rows } = await pool.query<{
    id: string; user_id: string; date: Date; distance: number | null;
    strava_id: string | null; strava_source: string | null;
  }>(`
    SELECT f.id, f.user_id, f.date, f.distance, f.strava_id, f.strava_source
    FROM field_notes f
    JOIN strava_connections s ON s.user_id = f.user_id
    WHERE f.start_time IS NULL
      AND jsonb_typeof(f.gpx_data) = 'object'
      AND NOT (f.gpx_data ? 'timesCheckedOnStrava')
    ORDER BY f.date DESC
  `);
  let restored = 0;
  for (const trip of rows) {
    let activityId = trip.strava_source === "strava-activity" ? trip.strava_id : null;
    if (!activityId) {
      const day = Math.floor(new Date(trip.date).getTime() / 1000);
      const activities = await stravaJson<StravaActivitySummary[]>(
        trip.user_id,
        `/athlete/activities?after=${day - 86400}&before=${day + 86400}&per_page=50`,
      );
      activityId = activities
        ? matchStravaActivity({ date: new Date(trip.date), distanceMiles: trip.distance }, activities)?.id.toString() ?? null
        : null;
    }

    let fields: ReturnType<typeof timedTripFields> | null = null;
    if (activityId) {
      const activity = await stravaJson<StravaActivitySummary>(trip.user_id, `/activities/${activityId}`);
      const streams = activity
        ? await stravaJson<Parameters<typeof buildGpxFromActivity>[1]>(
            trip.user_id,
            `/activities/${activityId}/streams?keys=latlng,altitude,time&key_by_type=true`,
          )
        : null;
      if (activity && streams?.latlng?.data?.length) {
        fields = timedTripFields(buildGpxFromActivity(activity, streams));
      }
    }

    const patch: Record<string, unknown> = { timesCheckedOnStrava: activityId ?? false };
    if (fields?.timedTrack) patch.timedTrack = fields.timedTrack;
    await pool.query(
      `UPDATE field_notes
         SET gpx_data = gpx_data || $2::jsonb,
             start_time = COALESCE(start_time, $3),
             end_time = COALESCE(end_time, $4)
       WHERE id = $1`,
      [trip.id, JSON.stringify(patch), fields?.startTime ?? null, fields?.endTime ?? null],
    );
    if (fields?.timedTrack) restored += 1;
  }
  return { restored, checked: rows.length };
}
