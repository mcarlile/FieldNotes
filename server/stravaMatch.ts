const METERS_PER_MILE = 1609.344;
export interface StravaActivitySummary {
  id: number;
  name: string;
  start_date: string;
  sport_type: string;
  distance: number; // meters
}

/**
 * The Strava activity that is the same outing as a trip: within a day of the
 * trip's date, within 5% of its distance, closest in start time. Trips made
 * from a GPX or an Apple Health workout often have a twin on Strava that still
 * has every point's time.
 */
export function matchStravaActivity(
  trip: { date: Date; distanceMiles: number | null },
  activities: StravaActivitySummary[],
): StravaActivitySummary | null {
  if (!trip.distanceMiles) return null;
  const tripMeters = trip.distanceMiles * METERS_PER_MILE;
  const candidates = activities.filter((a) => {
    const apart = Math.abs(new Date(a.start_date).getTime() - trip.date.getTime());
    return apart <= 24 * 3600 * 1000 && Math.abs(a.distance - tripMeters) <= tripMeters * 0.05;
  });
  candidates.sort(
    (a, b) =>
      Math.abs(new Date(a.start_date).getTime() - trip.date.getTime()) -
      Math.abs(new Date(b.start_date).getTime() - trip.date.getTime()),
  );
  return candidates[0] ?? null;
}
