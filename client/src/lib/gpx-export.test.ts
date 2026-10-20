import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGpxExport, gpxFilename } from "./gpx-export";
import { parseGpxData } from "../../../shared/gpx-utils";

test("raw GPX strings are exported unchanged", () => {
  const raw = '<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>';
  assert.equal(buildGpxExport(raw, "Ride"), raw);
});

test("coordinate-only tracks become a valid GPX that round-trips", () => {
  const gpx = buildGpxExport(
    { coordinates: [[-122.1, 37.1], [-122.2, 37.2]], elevationProfile: [{ elevation: 100 }, { elevation: 200 }] },
    "Hills & <Valleys>",
    "2026-10-01T12:00:00Z",
  )!;
  assert.match(gpx, /<name>Hills &amp; &lt;Valleys&gt;<\/name>/);
  assert.match(gpx, /<time>2026-10-01T12:00:00.000Z<\/time>/);
  const parsed = parseGpxData(gpx);
  assert.deepEqual(parsed.coordinates, [[-122.1, 37.1], [-122.2, 37.2]]);
});

test("missing track data exports nothing", () => {
  assert.equal(buildGpxExport(null, "x"), null);
  assert.equal(buildGpxExport({ coordinates: [] }, "x"), null);
});

test("filenames are slugged from the title", () => {
  assert.equal(gpxFilename("Mt. Tam Loop!"), "mt-tam-loop.gpx");
  assert.equal(gpxFilename("???"), "field-note.gpx");
});
