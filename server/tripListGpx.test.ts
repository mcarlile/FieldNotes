import { test } from "node:test";
import assert from "node:assert/strict";
import { listGpxData, LIST_ROUTE_POINTS } from "./tripListGpx";

test("a long route keeps only its shape, thinned, with both ends", () => {
  const coordinates = Array.from({ length: 13000 }, (_, i) => [-120 + i / 1e4, 39 + i / 1e4]);
  const slim = listGpxData({ coordinates, elevationProfile: [1, 2], timedTrack: { points: [] } });
  assert.equal(slim?.coordinates.length, LIST_ROUTE_POINTS);
  assert.deepEqual(slim?.coordinates[0], coordinates[0]);
  assert.deepEqual(slim?.coordinates.at(-1), coordinates.at(-1));
  assert.deepEqual(Object.keys(slim!), ["coordinates"]);
});

test("a short route is kept as is", () => {
  const coordinates = [[-120, 39], [-120.1, 39.1]];
  assert.deepEqual(listGpxData({ coordinates }), { coordinates });
});

test("gpxData stored as a JSON string still gives a route", () => {
  assert.deepEqual(listGpxData(JSON.stringify({ coordinates: [[1, 2]] })), { coordinates: [[1, 2]] });
});

test("a trip without a route has no gpxData", () => {
  assert.equal(listGpxData(null), null);
  assert.equal(listGpxData("not gpx"), null);
  assert.equal(listGpxData({ coordinates: [] }), null);
});
