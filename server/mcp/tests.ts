/**
 * Run with:  npx tsx server/mcp/tests.ts
 *
 * Tests:
 *  1. GPX builder produces valid XML that parseGpxData can consume
 *  2. Distance and elevation are computed correctly
 *  3. Input validation rejects bad point arrays
 *  4. PKCE verification (S256)
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildGpxXml, type TrackPoint } from "./gpx-builder";
import { parseGpxData } from "@shared/gpx-utils";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    });
}

// ── GPX builder ──────────────────────────────────────────────────────────────

// Two well-known points roughly 1 mile apart (approx 1.6 km on the PCT near Whitney Portal)
const POINTS: TrackPoint[] = [
  [36.578, -118.292, 2550, "2024-07-15T08:00:00Z"],
  [36.585, -118.298, 2600, "2024-07-15T08:30:00Z"],
  [36.592, -118.305, 2650, "2024-07-15T09:00:00Z"],
];

test("buildGpxXml produces XML with correct structure", () => {
  const xml = buildGpxXml("Test Track", POINTS);
  assert.ok(xml.includes("<gpx "), "missing <gpx> root");
  assert.ok(xml.includes("<trkpt "), "missing <trkpt>");
  assert.ok(xml.includes("<ele>"), "missing <ele>");
  assert.ok(xml.includes("<time>"), "missing <time>");
  assert.ok(xml.includes('lat="36.578"'), "lat not found");
  assert.ok(xml.includes('lon="-118.292"'), "lon not found");
  assert.ok(xml.includes("Test Track"), "track name not found");
});

test("parseGpxData correctly parses buildGpxXml output", () => {
  const xml = buildGpxXml("Whitney PCT", POINTS);
  const stats = parseGpxData(xml);
  assert.ok(stats.distance > 0, "distance should be positive");
  assert.ok(stats.elevationGain >= 0, "elevationGain should be non-negative");
  assert.ok(stats.coordinates.length === POINTS.length, "coordinate count mismatch");
  // Distance should be roughly 0.5–1.5 miles for these points
  assert.ok(stats.distance < 2, `distance ${stats.distance} seems too large`);
  assert.ok(stats.distance > 0.1, `distance ${stats.distance} seems too small`);
  // Elevation gain: 100m = 328ft, points go 2550→2650m = 100m gain
  assert.ok(stats.elevationGain > 200, `elevationGain ${stats.elevationGain} ft seems too low`);
});

test("coordinates are [longitude, latitude] pairs", () => {
  const xml = buildGpxXml("Test", POINTS);
  const stats = parseGpxData(xml);
  // gpx-utils returns [lon, lat] pairs
  const [lon, lat] = stats.coordinates[0];
  assert.ok(Math.abs(lon - (-118.292)) < 0.001, `lon mismatch: ${lon}`);
  assert.ok(Math.abs(lat - 36.578) < 0.001, `lat mismatch: ${lat}`);
});

test("buildGpxXml handles null elevation and timestamp", () => {
  const pts: TrackPoint[] = [
    [36.578, -118.292, null, null],
    [36.585, -118.298, null, null],
  ];
  const xml = buildGpxXml("No EXIF", pts);
  assert.ok(!xml.includes("<ele>"), "should not have <ele> when null");
  assert.ok(!xml.includes("<time>"), "should not have <time> when null");
  const stats = parseGpxData(xml);
  assert.ok(stats.coordinates.length === 2);
  assert.ok(stats.elevationGain === 0, "elevation gain should be 0 with no elevations");
});

test("buildGpxXml rejects fewer than 2 points", () => {
  assert.throws(
    () => buildGpxXml("Single", [[36.578, -118.292, null, null]]),
    /at least 2 points/,
  );
});

test("buildGpxXml rejects out-of-range coordinates", () => {
  assert.throws(
    () => buildGpxXml("Bad lat", [[91, 0, null, null], [0, 0, null, null]]),
    /latitude/,
  );
  assert.throws(
    () => buildGpxXml("Bad lon", [[0, 200, null, null], [0, 1, null, null]]),
    /longitude/,
  );
});

test("escapes XML special characters in track name", () => {
  const xml = buildGpxXml("Trail <&> Adventure \"Test\"", POINTS);
  assert.ok(xml.includes("Trail &lt;&amp;&gt; Adventure &quot;Test&quot;"), "XML escaping failed");
});

// ── PKCE verification ────────────────────────────────────────────────────────

function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === "S256") {
    const computed = crypto.createHash("sha256").update(verifier).digest("base64url");
    return computed === challenge;
  }
  return verifier === challenge;
}

test("PKCE S256 verification succeeds with correct verifier", () => {
  const verifier = crypto.randomBytes(40).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.ok(verifyPkce(verifier, challenge, "S256"), "should pass PKCE verification");
});

test("PKCE S256 verification fails with wrong verifier", () => {
  const challenge = crypto.createHash("sha256").update("correct").digest("base64url");
  assert.ok(!verifyPkce("wrong", challenge, "S256"), "should fail with wrong verifier");
});

// ── summary ──────────────────────────────────────────────────────────────────

// Give async tests time to settle
setTimeout(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 200);

console.log("\nFieldNotes MCP — unit tests\n");
