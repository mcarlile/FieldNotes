import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestTrackOffset, smoothTrackPositionAt, trackBearingAt, trackPositionAt, trackSegmentBetween, type CompactTimedTrack } from "./gpx-utils";

const track: CompactTimedTrack = {
  startTime: "2026-10-17T18:58:27.067Z",
  durationSeconds: 30,
  points: [
    [0, 39.0, -120.0],
    [10, 39.1, -120.1],
    [20, 39.2, -120.2],
    [30, 39.3, -120.3],
  ],
};

test("trackPositionAt interpolates between points and clamps to the ends", () => {
  const mid = trackPositionAt(track, 15)!;
  assert.ok(Math.abs(mid[0] - -120.15) < 1e-9 && Math.abs(mid[1] - 39.15) < 1e-9);
  assert.deepEqual(trackPositionAt(track, -5), [-120.0, 39.0]);
  assert.deepEqual(trackPositionAt(track, 99), [-120.3, 39.3]);
  assert.equal(trackPositionAt(null, 5), null);
});

test("smoothTrackPositionAt stays on a straight route and moves smoothly over a wobble", () => {
  // On a straight, steady stretch the blur changes nothing.
  const straight = smoothTrackPositionAt(track, 15)!;
  assert.ok(Math.abs(straight[0] - -120.15) < 1e-9 && Math.abs(straight[1] - 39.15) < 1e-9);
  assert.equal(smoothTrackPositionAt(null, 5), null);

  // A 1 Hz track with a GPS jog sideways at 5 s.
  const wobbly: CompactTimedTrack = {
    startTime: track.startTime,
    durationSeconds: 10,
    points: Array.from({ length: 11 }, (_, i) => [i, 39 + (i === 5 ? 0.00005 : 0), -120 + i * 0.0001] as [number, number, number]),
  };
  const peak = smoothTrackPositionAt(wobbly, 5)!;
  // The jog is softened to well under half its size...
  assert.ok(peak[1] - 39 < 0.00002, `got ${peak[1] - 39}`);
  // ...and the pin's speed barely changes as it passes a GPS point, where the
  // straight-line version kinks.
  const speed = (t: number) => smoothTrackPositionAt(wobbly, t + 0.05)![0] - smoothTrackPositionAt(wobbly, t - 0.05)![0];
  assert.ok(Math.abs(speed(3.0) - speed(3.5)) < 1e-7);
});

test("trackSegmentBetween keeps the points inside the range plus interpolated ends", () => {
  const segment = trackSegmentBetween(track, 5, 25);
  assert.equal(segment.length, 4);
  assert.deepEqual(segment.slice(1, 3), [[-120.1, 39.1], [-120.2, 39.2]]);
  assert.ok(Math.abs(segment[0][0] - -120.05) < 1e-9);
  assert.ok(Math.abs(segment[3][0] - -120.25) < 1e-9);
  assert.deepEqual(trackSegmentBetween(track, 20, 10), []);
  assert.deepEqual(trackSegmentBetween(undefined, 0, 10), []);
});

test("nearestTrackOffset turns a nearby map position back into a route time", () => {
  // Just off the route, a quarter of the way from the 10 s point to the 20 s point.
  const t = nearestTrackOffset(track, [-120.125, 39.1251], 0, 30)!;
  assert.ok(Math.abs(t - 12.5) < 0.05, `got ${t}`);
  // The window clamps the answer.
  assert.equal(nearestTrackOffset(track, [-120.3, 39.3], 0, 18), 18);
  assert.equal(nearestTrackOffset(null, [-120, 39], 0, 30), null);
});

test("trackBearingAt gives the direction of travel", () => {
  const north: CompactTimedTrack = { startTime: track.startTime, durationSeconds: 20, points: [[0, 39.0, -120.0], [20, 39.01, -120.0]] };
  const east: CompactTimedTrack = { startTime: track.startTime, durationSeconds: 20, points: [[0, 39.0, -120.0], [20, 39.0, -119.99]] };
  assert.ok(Math.abs(trackBearingAt(north, 10)!) < 0.5 || Math.abs(trackBearingAt(north, 10)! - 360) < 0.5);
  assert.ok(Math.abs(trackBearingAt(east, 10)! - 90) < 0.5);
  const stopped: CompactTimedTrack = { startTime: track.startTime, durationSeconds: 20, points: [[0, 39.0, -120.0], [20, 39.0, -120.0]] };
  assert.equal(trackBearingAt(stopped, 10), null);
});
