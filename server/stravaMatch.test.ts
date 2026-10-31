import { test } from "node:test";
import assert from "node:assert/strict";
import { matchStravaActivity } from "./stravaMatch";

const activity = (id: number, start: string, miles: number) => ({
  id, name: "Ride", sport_type: "Ride", start_date: start, distance: miles * 1609.344,
});

test("picks the activity with the same distance, closest in time", () => {
  const match = matchStravaActivity(
    { date: new Date("2026-10-27T07:00:00Z"), distanceMiles: 10.73 },
    [
      activity(1, "2026-10-27T22:20:00Z", 25),
      activity(2, "2026-10-27T22:25:00Z", 10.6),
      activity(3, "2026-10-28T06:30:00Z", 10.8),
    ],
  );
  assert.equal(match?.id, 2);
});

test("no activity of a similar distance means no match", () => {
  const match = matchStravaActivity(
    { date: new Date("2026-10-27T22:20:00Z"), distanceMiles: 10.73 },
    [activity(1, "2026-10-27T22:20:00Z", 12)],
  );
  assert.equal(match, null);
});

test("a trip without a distance is never matched", () => {
  assert.equal(matchStravaActivity({ date: new Date(), distanceMiles: null }, [activity(1, new Date().toISOString(), 1)]), null);
});
