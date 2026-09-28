import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeRoutePolyline,
  simplifyRouteCoordinates,
  staticRoutePath,
  validRouteCoordinates,
} from "./static-route-path";

test("encodes the precision-5 polyline in latitude/longitude order", () => {
  const points: [number, number][] = [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ];
  assert.equal(encodeRoutePolyline(points), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.equal(
    staticRoutePath(points, 3),
    `path-3+1a1815-0.85(${encodeURIComponent("_p~iF~ps|U_ulLnnqC_mqNvxq`@")})`,
  );
});

test("URI-encodes reserved characters inside the polyline", () => {
  const path = staticRoutePath([[0, 0], [0, -0.00005]], 2);
  assert.ok(path);
  assert.ok(path?.includes("%3F")); // zero deltas encode to '?'
  assert.equal(decodeURIComponent(path!.slice(path!.indexOf("(") + 1, -1)), encodeRoutePolyline([[0, 0], [0, -0.00005]]));
});

test("rejects malformed, nonfinite and out-of-range coordinates", () => {
  assert.deepEqual(
    validRouteCoordinates([[180, 90], [-180, -90], [NaN, 2], [0, Infinity], [181, 0], [0, -91], ["1", 2], null, [5]]),
    [[180, 90], [-180, -90]],
  );
  assert.deepEqual(validRouteCoordinates("invalid"), []);
  assert.equal(staticRoutePath([], 3), null);
  assert.equal(staticRoutePath([[0, 0]], 3), null);
});

test("limits long tracks to 100 points while retaining first and last", () => {
  for (const length of [101, 199, 200, 1000]) {
    const points: [number, number][] = Array.from({ length }, (_, i) => [i / 100, i / 200]);
    const simplified = simplifyRouteCoordinates(points);
    assert.equal(simplified.length, 100);
    assert.deepEqual(simplified[0], points[0]);
    assert.deepEqual(simplified.at(-1), points.at(-1));
    assert.equal(new Set(simplified).size, 100);
  }
});