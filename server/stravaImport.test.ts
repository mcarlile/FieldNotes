import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test@localhost:1/test";
const { findExistingTrips, photoDownloads, tripTypeForStravaSport } = await import("./stravaImport");

const activity = (id: number, start: string, miles: number) => ({
  id, name: "Ride", sport_type: "Ride", start_date: start, distance: miles * 1609.344,
});
const trip = (id: string, date: string, distance: number | null, stravaId: string | null = null) => ({
  id, title: id, date: new Date(date), distance, stravaId, stravaSource: stravaId ? "strava-activity" : null,
});

test("an activity linked by id is that trip, even if the distance differs", () => {
  const found = findExistingTrips([activity(11, "2026-11-10T23:59:00Z", 20)], [trip("t1", "2026-01-01T00:00:00Z", 5, "11")]);
  assert.deepEqual(found.get(11), { tripId: "t1", title: "t1", by: "strava_id" });
});

test("an unlinked trip of the same day and distance holds the activity", () => {
  const found = findExistingTrips(
    [activity(1, "2026-11-05T23:50:00Z", 8.2), activity(2, "2026-11-06T18:00:00Z", 14)],
    [trip("health", "2026-11-05T23:51:00Z", 8.1)],
  );
  assert.equal(found.get(1)?.by, "date_and_distance");
  assert.equal(found.has(2), false);
});

test("one trip never claims two activities", () => {
  const found = findExistingTrips(
    [activity(1, "2026-11-05T20:00:00Z", 8), activity(2, "2026-11-05T21:00:00Z", 8)],
    [trip("t", "2026-11-05T20:05:00Z", 8)],
  );
  assert.equal(found.size, 1);
  assert.equal(found.get(1)?.tripId, "t");
});

test("a trip linked to one activity isn't also matched to another", () => {
  const found = findExistingTrips(
    [activity(1, "2026-11-05T20:00:00Z", 8), activity(2, "2026-11-05T20:10:00Z", 8)],
    [trip("t", "2026-11-05T20:00:00Z", 8, "2")],
  );
  assert.equal(found.get(2)?.tripId, "t");
  assert.equal(found.has(1), false);
});

test("photo downloads take the largest size and skip videos and placeholders", () => {
  const downloads = photoDownloads([
    { unique_id: "a", urls: { "100": "https://x/small.jpg", "2048": "https://x/big.jpg" } },
    { unique_id: "v", urls: { "2048": "https://x/v.jpg" }, video_url: "https://x/v.mp4" },
    { unique_id: "p", urls: { "2048": "https://x/placeholder-photo.png" } },
    { unique_id: "n" },
  ]);
  assert.deepEqual(downloads.map((d) => d.url), ["https://x/big.jpg"]);
});

test("Strava sports map to Big Miles trip types", () => {
  assert.equal(tripTypeForStravaSport("MountainBikeRide"), "cycling");
  assert.equal(tripTypeForStravaSport("TrailRun"), "running");
  assert.equal(tripTypeForStravaSport("BackcountrySki"), "skiing");
  assert.equal(tripTypeForStravaSport("Walk"), "hiking");
  assert.equal(tripTypeForStravaSport("Yoga"), "other");
});
