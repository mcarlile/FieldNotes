import { describe, expect, it } from "vitest";
import {
  getTimedTrack,
  interpolateCoordinatesAtOffset,
  parseGpxWithTimestamps,
  resolveClipCoordinates,
  toCompactTimedTrack,
} from "./gpx-utils";

// Straight line heading north: one point every 10 seconds, 0.001° latitude apart
const START = Date.parse("2026-10-10T20:45:00Z");
const POINTS = Array.from({ length: 11 }, (_, i) => ({
  lat: 39 + i * 0.001,
  lon: -120,
  time: new Date(START + i * 10_000).toISOString(),
}));
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
${POINTS.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>1800</ele><time>${p.time}</time></trkpt>`).join("\n")}
</trkseg></trk></gpx>`;

describe("toCompactTimedTrack / getTimedTrack", () => {
  it("round-trips a parsed track through the compact stored form", () => {
    const compact = toCompactTimedTrack(parseGpxWithTimestamps(GPX))!;
    expect(compact.startTime).toBe("2026-10-10T20:45:00.000Z");
    expect(compact.points).toHaveLength(11);
    expect(compact.points[10]).toEqual([100, 39.01, -120]);

    const track = getTimedTrack({ coordinates: [], timedTrack: compact })!;
    expect(track.durationSeconds).toBe(100);
    expect(track.startTime?.toISOString()).toBe("2026-10-10T20:45:00.000Z");
    expect(track.endTime?.toISOString()).toBe("2026-10-10T20:46:40.000Z");
  });

  it("reads raw GPX strings and { rawGpx } objects", () => {
    expect(getTimedTrack(GPX)?.points).toHaveLength(11);
    expect(getTimedTrack({ rawGpx: GPX })?.points).toHaveLength(11);
  });

  it("returns null when there are no timestamps", () => {
    expect(getTimedTrack({ coordinates: [[-120, 39]] })).toBeNull();
    expect(getTimedTrack(GPX.replace(/<time>[^<]*<\/time>/g, ""))).toBeNull();
    expect(getTimedTrack(null)).toBeNull();
  });
});

describe("interpolateCoordinatesAtOffset", () => {
  const track = parseGpxWithTimestamps(GPX);

  it("interpolates between points", () => {
    expect(interpolateCoordinatesAtOffset(track, 25)!.latitude).toBeCloseTo(39.0025, 6);
  });

  it("clamps to the ends of the track", () => {
    expect(interpolateCoordinatesAtOffset(track, -50)!.latitude).toBeCloseTo(39, 6);
    expect(interpolateCoordinatesAtOffset(track, 500)!.latitude).toBeCloseTo(39.01, 6);
  });
});

describe("resolveClipCoordinates", () => {
  const stored = { coordinates: POINTS.map((p) => [p.lon, p.lat]), timedTrack: toCompactTimedTrack(parseGpxWithTimestamps(GPX)) };

  it("uses timestamps from the stored timed track", () => {
    const coords = resolveClipCoordinates(stored, 20, 60);
    expect(coords.startLatitude).toBeCloseTo(39.002, 6);
    expect(coords.endLatitude).toBeCloseTo(39.006, 6);
  });

  it("moves both ends along the route when a sync offset is added to the clip times", () => {
    const offset = 15;
    const coords = resolveClipCoordinates(stored, 20 + offset, 60 + offset);
    expect(coords.startLatitude).toBeCloseTo(39.0035, 6);
    expect(coords.endLatitude).toBeCloseTo(39.0075, 6);
  });

  it("falls back to the track's first and last points without timestamps or duration", () => {
    const coords = resolveClipCoordinates({ coordinates: stored.coordinates }, 20, 60);
    expect(coords.startLatitude).toBe(39);
    expect(coords.endLatitude).toBe(39.01);
  });
});
