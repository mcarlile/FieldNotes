import { test } from "node:test";
import assert from "node:assert/strict";
import { clipOffsetSeconds, clipStartFromRecording, parseCameraFilenameTime, readMp4CreationTime, routeStartOf } from "./clip-timing";
import { compactTimedTrack, parseGpxData, resolveClipCoordinates } from "./gpx-utils";

test("camera filenames give the local recording start", () => {
  const date = parseCameraFilenameTime("VID_20261017_142758_00_004.mp4");
  assert.deepEqual(date, new Date(2026, 9, 17, 14, 27, 58));
  assert.deepEqual(parseCameraFilenameTime("20261017_142758.MOV"), new Date(2026, 9, 17, 14, 27, 58));
  assert.equal(parseCameraFilenameTime("clip-final.mp4"), null);
  assert.equal(parseCameraFilenameTime("VID_20261317_142758.mp4"), null);
});

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
}

test("mvhd creation time is read from the moov box", async () => {
  const mvhd = new Uint8Array(100);
  const created = Date.UTC(2026, 9, 17, 21, 27, 58) / 1000 + 2082844800;
  new DataView(mvhd.buffer).setUint32(4, created); // version 0: flags, then creation_time
  const file = new Uint8Array([...box("ftyp", new Uint8Array(12)), ...box("mdat", new Uint8Array(64)), ...box("moov", box("mvhd", mvhd))]);
  const read = async (start: number, end: number) => file.slice(start, end);
  assert.deepEqual(await readMp4CreationTime(read, file.length), new Date("2026-10-17T21:27:58Z"));
  assert.equal(await readMp4CreationTime(read, 20), null);
});

test("clip offsets are only used when plausible", () => {
  const routeStart = "2026-10-17T18:58:27.067Z";
  assert.equal(clipOffsetSeconds(new Date("2026-10-17T21:28:00.942Z"), routeStart), 8974);
  assert.equal(clipOffsetSeconds(new Date("2026-10-17T18:00:00Z"), routeStart), null);
  assert.equal(clipOffsetSeconds(new Date("2026-10-20T03:37:25Z"), routeStart), null);
  assert.equal(clipOffsetSeconds(null, routeStart), null);
});

const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><time>2026-10-18T20:27:52Z</time></metadata>
<trk><trkseg>
<trkpt lat="39.0" lon="-120.0"><ele>1800</ele><time>2026-10-17T18:00:00Z</time></trkpt>
<trkpt lat="39.1" lon="-120.0"><ele>1810</ele><time>2026-10-17T19:00:00Z</time></trkpt>
<trkpt lat="39.2" lon="-120.0"><ele>1820</ele><time>2026-10-17T20:00:00Z</time></trkpt>
</trkseg></trk></gpx>`;

test("GPX date is the first track point, not the export time", () => {
  assert.deepEqual(parseGpxData(gpx).date, new Date("2026-10-17T18:00:00Z"));
});

test("clips are placed on the route by time", () => {
  const timedTrack = compactTimedTrack(gpx);
  assert.equal(timedTrack?.startTime, "2026-10-17T18:00:00.000Z");
  assert.equal(timedTrack?.durationSeconds, 7200);
  const coords = resolveClipCoordinates({ coordinates: [], timedTrack }, 1800, 5400);
  assert.ok(Math.abs(coords.startLatitude! - 39.05) < 1e-9);
  assert.ok(Math.abs(coords.endLatitude! - 39.15) < 1e-9);
});

test("new clips start at their recording time on the route, or at 0", () => {
  const trip = { gpxData: { timedTrack: { startTime: "2026-10-17T18:00:00.000Z" } }, startTime: null };
  const start = routeStartOf(trip);
  assert.equal(clipStartFromRecording("2026-10-17T18:30:00Z", start), 1800);
  assert.equal(clipStartFromRecording("2026-10-17T17:00:00Z", start), 0);
  assert.equal(clipStartFromRecording("not a date", start), 0);
  assert.equal(clipStartFromRecording(undefined, start), 0);
  assert.equal(clipStartFromRecording("2026-10-17T18:30:00Z", routeStartOf({ gpxData: null, startTime: null })), 0);
  assert.deepEqual(routeStartOf({ gpxData: null, startTime: "2026-10-17T18:00:00Z" }), new Date("2026-10-17T18:00:00Z"));
});
