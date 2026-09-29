import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { StravaConnection } from "@shared/schema";
import { readStravaPreview, StravaPreviewError } from "./stravaPreview";

const now = 1_800_000_000_000;
const connection: StravaConnection = {
  id: "connection", userId: "owner-a", stravaAthleteId: 123,
  accessToken: "test-access", refreshToken: "test-refresh",
  expiresAt: now / 1000 + 3600, scope: "read,activity:read_all",
  connectedAt: new Date(now), updatedAt: new Date(now),
};
const noNetwork: typeof fetch = async () => { throw new Error("Unexpected network request"); };

test("status is account-scoped and never exposes credentials or requests Strava", async () => {
  const calls: string[] = [];
  const get = async (id: string) => { calls.push(id); return id === "owner-a" ? connection : undefined; };
  const result = await readStravaPreview("/api/strava/status", "owner-a", get, noNetwork, now);
  assert.deepEqual(result, {
    state: "connected", connected: true, stravaAthleteId: 123,
    previewAvailable: true, previewMessage: undefined,
  });
  assert.equal((await readStravaPreview("/api/strava/status", "owner-b", get, noNetwork, now) as any).connected, false);
  assert.deepEqual(calls, ["owner-a", "owner-b"]);
  assert.doesNotMatch(JSON.stringify(result), /test-access|test-refresh/);
});

test("missing, expired, nearly expired, and wrong-owner credentials never issue requests", async () => {
  for (const conn of [
    undefined, { ...connection, expiresAt: null },
    { ...connection, expiresAt: now / 1000 - 1 },
    { ...connection, expiresAt: now / 1000 + 59 },
    { ...connection, userId: "owner-b" },
    { ...connection, accessToken: null },
  ]) {
    for (const path of ["/api/strava/activities", "/api/strava/routes"]) {
      await assert.rejects(readStravaPreview(path, "owner-a", async () => conn, noNetwork, now),
        (error: unknown) => error instanceof StravaPreviewError && error.status === 409);
    }
  }
});

test("feeds make one fixed GET and return only display fields, without writes", async () => {
  const before = structuredClone(connection);
  for (const path of ["/api/strava/activities", "/api/strava/routes"]) {
    const calls: string[] = [];
    const request: typeof fetch = async (url, options) => {
      calls.push(String(url));
      assert.equal(options?.method, "GET");
      assert.equal(options?.redirect, "error");
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-access");
      return Response.json([{
        id: 1, name: "Trail", sport_type: "Run", start_date: "2026-09-01",
        distance: 1200, total_elevation_gain: 300, type: 2, elevation_gain: 300,
        accessToken: "never-return", athlete: { private: "never-return" },
      }]);
    };
    const result = await readStravaPreview(path, "owner-a", async () => connection, request, now);
    assert.deepEqual(calls, [path.endsWith("activities")
      ? "https://www.strava.com/api/v3/athlete/activities?per_page=30"
      : "https://www.strava.com/api/v3/athletes/123/routes?per_page=30"]);
    assert.equal((result as any[])[0].name, "Trail");
    assert.doesNotMatch(JSON.stringify(result), /never-return|accessToken|athlete/);
  }
  assert.deepEqual(connection, before);
});

test("authorization failures, rate limits, bad data, and transport errors never refresh or retry", async () => {
  for (const status of [401, 403, 429, 500, 200, 0]) {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls++;
      if (status === 0) throw new Error("sensitive upstream details");
      return Response.json({ secret: "sensitive upstream details" }, { status });
    };
    await assert.rejects(readStravaPreview("/api/strava/activities", "owner-a", async () => connection, request, now),
      (error: unknown) => {
        assert.ok(error instanceof StravaPreviewError);
        assert.doesNotMatch(error.message, /sensitive/);
        return true;
      });
    assert.equal(calls, 1);
  }
});

test("action URLs and arbitrary URLs are rejected before reading credentials", async () => {
  for (const path of [
    "/api/strava/auth", "/api/strava/callback", "/api/strava/disconnect",
    "/api/strava/import/activity/1", "/api/strava/associate/route/1",
    "/oauth/token", "https://evil.example", "/api/strava/activities/../auth",
  ]) {
    assert.equal(await readStravaPreview(path, "owner-a", async () => {
      throw new Error("Must not read credentials");
    }, noNetwork, now), undefined);
  }
});

test("bridge and preview UI retain write barriers and never delegate to live Strava routines", () => {
  const bridge = readFileSync(new URL("./designPreview.ts", import.meta.url), "utf8");
  const reader = readFileSync(new URL("./stravaPreview.ts", import.meta.url), "utf8");
  const inbox = readFileSync(new URL("../client/src/pages/inbox.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(bridge + reader, /getValidStravaToken|stravaFetch|importGpxToInbox|upsertStravaConnection/);
  assert.match(bridge, /req.method !== "GET"/);
  assert.match(bridge, /if \(result === undefined\) return res.sendStatus\(403\)/);
  assert.match(inbox, /<StravaPanel readOnly=\{readOnlyPreview\}/);
  assert.match(inbox, /if \(readOnly\) return;/);
  assert.equal((inbox.match(/!readOnly && <div className="flex items-center gap-3 shrink-0"/g) ?? []).length, 2);
});