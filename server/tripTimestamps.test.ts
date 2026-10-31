import { test } from "node:test";
import assert from "node:assert/strict";
import { gpxDataTimes } from "./tripTimestamps";

test("times come from the timedTrack the iOS app sends", () => {
  const times = gpxDataTimes({
    coordinates: [[-120, 39]],
    timedTrack: { startTime: "2026-10-27T22:20:00Z", durationSeconds: 3600, points: [[0, 39, -120]] },
  });
  assert.equal(times?.startTime.toISOString(), "2026-10-27T22:20:00.000Z");
  assert.equal(times?.endTime.toISOString(), "2026-10-27T23:20:00.000Z");
});

test("times come from raw GPX text", () => {
  const gpx = `<gpx><trk><trkseg>
    <trkpt lat="39" lon="-120"><time>2026-10-27T22:20:00Z</time></trkpt>
    <trkpt lat="39.001" lon="-120.001"><time>2026-10-27T22:21:00Z</time></trkpt>
  </trkseg></trk></gpx>`;
  const times = gpxDataTimes(gpx);
  assert.equal(times?.startTime.toISOString(), "2026-10-27T22:20:00.000Z");
  assert.equal(times?.endTime.toISOString(), "2026-10-27T22:21:00.000Z");
});

test("a route without times gives none", () => {
  assert.equal(gpxDataTimes({ coordinates: [[-120, 39]], timedTrack: null }), null);
  assert.equal(gpxDataTimes({ coordinates: [[-120, 39]] }), null);
  assert.equal(gpxDataTimes(null), null);
});
