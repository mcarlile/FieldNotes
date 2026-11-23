import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignClipToRoute,
  detectClipStart,
  findPairedGpx,
  parseClipGpx,
  recordedAtFromGpx,
  recordingStartFromFile,
} from "./clip-gps";
import type { CompactTimedTrack } from "./gpx-utils";

// A rider heading north at 5 m/s from (39.35, -120.366), starting at `start`.
const METERS_PER_DEG_LAT = 110_540;
const latAt = (secondsFromStart: number) => 39.35 + (secondsFromStart * 5) / METERS_PER_DEG_LAT;

/**
 * GPX in the Insta360 Studio shape: ten points a second, each run of ten
 * sharing the whole-second timestamp.
 */
function insta360Gpx(startIso: string, seconds: number, firstRun = 10): string {
  const start = Date.parse(startIso);
  const points: string[] = [];
  for (let s = 0; s < seconds; s++) {
    const count = s === 0 ? firstRun : 10;
    for (let i = 0; i < count; i++) {
      const sub = s === 0 ? 10 - count + i : i;
      const time = new Date(start + s * 1000).toISOString().replace(".000", "");
      points.push(
        `<trkpt lat="${latAt(s + sub / 10)}" lon="-120.366"><ele>2480</ele><time>${time}</time></trkpt>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Insta360 Studio" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>2026-11-23T05:09:59Z</time>
    <bounds maxlat="39.4" maxlon="120.36" minlat="39.3" minlon="120.37"/></metadata>
  <trk><name>Insta360 GPS Data</name><trkseg>
${points.join("\n")}
  </trkseg></trk></gpx>`;
}

/** A 1 Hz route along the same line, starting `leadSeconds` before the GPX. */
function route(routeStartIso: string, gpxStartIso: string, seconds: number): CompactTimedTrack {
  const lead = (Date.parse(gpxStartIso) - Date.parse(routeStartIso)) / 1000;
  const points: [number, number, number][] = [];
  for (let t = 0; t <= seconds; t++) points.push([t, latAt(t - lead), -120.366]);
  return { startTime: routeStartIso, durationSeconds: seconds, points };
}

test("Insta360 GPX runs are spread across their second", () => {
  const track = parseClipGpx(insta360Gpx("2026-11-20T19:43:52Z", 3))!;
  assert.equal(track.points.length, 30);
  assert.equal(track.startMs, Date.parse("2026-11-20T19:43:52Z"));
  assert.equal(track.points[1].t - track.points[0].t, 100);
  assert.equal(track.points[10].t, Date.parse("2026-11-20T19:43:53Z"));
  assert.equal(track.endMs, Date.parse("2026-11-20T19:43:54.900Z"));
});

test("a short first run sits at the end of its second", () => {
  const track = parseClipGpx(insta360Gpx("2026-11-20T19:43:52Z", 4, 3))!;
  assert.equal(track.startMs, Date.parse("2026-11-20T19:43:52.700Z"));
});

test("GPX pairs with its video by name, ignoring a reframe label", () => {
  const gpx = new Map([
    ["VID_20261120_114343_00_050(a).gpx", "a"],
    ["VID_20261120_114343_00_050(b).gpx", "b"],
    ["VID_20261120_114654_00_051.gpx", "051"],
  ]);
  assert.equal(findPairedGpx("VID_20261120_114343_00_050(b).mp4", gpx), "b");
  assert.equal(findPairedGpx("VID_20261120_114654_00_051(landscape).mp4", gpx), "051");
  assert.equal(findPairedGpx("VID_20261120_115028_00_052(a).mp4", gpx), undefined);
});

test("the MP4 creation time wins over the filename inside the recording", () => {
  const filename = new Date("2026-11-20T19:43:43Z");
  const trimmed = new Date("2026-11-20T19:44:22Z");
  assert.equal(recordingStartFromFile(filename, trimmed)?.time, trimmed);
  // An export-time stamp days later is ignored.
  assert.equal(recordingStartFromFile(filename, new Date("2026-11-23T05:10:00Z"))?.time, filename);
  assert.equal(recordingStartFromFile(null, trimmed)?.source, "the video's metadata");
});

test("a GPX the length of the clip gives its start", () => {
  const track = parseClipGpx(insta360Gpx("2026-11-20T19:43:52Z", 26))!;
  assert.deepEqual(recordedAtFromGpx(track, 24.96, new Date("2026-11-20T19:43:43Z")), new Date(track.startMs));
});

test("a GPX of the whole recording keeps a start inside it", () => {
  const track = parseClipGpx(insta360Gpx("2026-11-20T19:43:42Z", 118))!;
  const trimmed = new Date("2026-11-20T19:44:22Z");
  assert.equal(recordedAtFromGpx(track, 7.3, trimmed), trimmed);
  assert.equal(recordedAtFromGpx(track, 7.3, new Date("2026-11-20T20:30:00Z")), null);
});

test("the clip's GPS path is matched to the route", () => {
  const gpxStart = "2026-11-20T19:43:52Z";
  const track = parseClipGpx(insta360Gpx(gpxStart, 26))!;
  // The route's clock runs 4 s behind the remote's.
  const r = route("2026-11-20T19:00:04Z", "2026-11-20T19:43:52Z", 3600);
  const aligned = alignClipToRoute(track, new Date(gpxStart), 25, r, new Date("2026-11-20T19:00:00Z"));
  assert.ok(aligned);
  assert.ok(Math.abs(aligned.shiftSeconds - -4) < 0.2, `shift ${aligned.shiftSeconds}`);
  assert.ok(aligned.meanErrorMeters < 2);
});

test("a clip where the rider stood still isn't GPS-matched", () => {
  const still = `<gpx><trk><trkseg>
    <trkpt lat="39.35" lon="-120.366"><time>2026-11-20T19:43:52Z</time></trkpt>
    <trkpt lat="39.35" lon="-120.366"><time>2026-11-20T19:44:20Z</time></trkpt>
  </trkseg></trk></gpx>`;
  const track = parseClipGpx(still)!;
  const r = route("2026-11-20T19:00:00Z", "2026-11-20T19:43:52Z", 3600);
  assert.equal(alignClipToRoute(track, new Date(track.startMs), 28, r, new Date("2026-11-20T19:00:00Z")), null);
});

test("detectClipStart prefers the GPX and falls back to the files", () => {
  const routeStart = "2026-11-20T19:00:00Z";
  const gpx = parseClipGpx(insta360Gpx("2026-11-20T19:43:52Z", 26))!;
  const fromGpx = detectClipStart({
    durationSeconds: 24.96,
    routeStart,
    gpx,
    filenameTime: new Date("2026-11-20T19:43:43Z"),
  })!;
  assert.equal(fromGpx.fromGpx, true);
  assert.equal(fromGpx.offsetSeconds, 43 * 60 + 52);

  const matched = detectClipStart({
    durationSeconds: 24.96,
    routeStart,
    route: route(routeStart, "2026-11-20T19:43:52Z", 3600),
    gpx,
  })!;
  assert.equal(matched.source, "the paired GPX, matched to the route");
  assert.ok(Math.abs(matched.offsetSeconds - (43 * 60 + 52)) < 0.3);

  const noGpx = detectClipStart({
    durationSeconds: 7.3,
    routeStart,
    filenameTime: new Date("2026-11-20T19:43:43Z"),
    metadataTime: new Date("2026-11-20T19:44:22Z"),
  })!;
  assert.equal(noGpx.fromGpx, false);
  assert.equal(noGpx.offsetSeconds, 44 * 60 + 22);
});
