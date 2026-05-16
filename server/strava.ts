import { storage } from "./storage";
import { parseGpxData } from "@shared/gpx-utils";
import type { GpxInboxItem } from "@shared/schema";

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";
const TOKEN_REFRESH_BUFFER_SECS = 300; // refresh 5 minutes before expiry

// ── Token management ─────────────────────────────────────────────────────────

export async function getValidStravaToken(userId: string): Promise<string> {
  const conn = await storage.getStravaConnection(userId);
  if (!conn) throw new Error("Strava account not connected");

  const nowSecs = Math.floor(Date.now() / 1000);
  if (conn.expiresAt > nowSecs + TOKEN_REFRESH_BUFFER_SECS) {
    return conn.accessToken;
  }

  // Token expired or close to expiry — refresh it
  const resp = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Strava token refresh failed: ${resp.status} ${body}`);
  }

  const data = await resp.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  await storage.updateStravaTokens(userId, data.access_token, data.refresh_token, data.expires_at);
  return data.access_token;
}

// Thin authenticated fetch wrapper against the Strava API
export async function stravaFetch(userId: string, path: string, options?: RequestInit): Promise<Response> {
  const token = await getValidStravaToken(userId);
  const url = path.startsWith("http") ? path : `${STRAVA_API}${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  return resp;
}

// ── GPX builder ──────────────────────────────────────────────────────────────

interface StravaActivity {
  id: number;
  name: string;
  start_date: string; // ISO 8601, e.g. "2026-05-16T13:50:11Z"
  sport_type: string;
}

interface StravaStreams {
  latlng?: { data: [number, number][] };   // [lat, lng] pairs
  altitude?: { data: number[] };            // meters
  time?: { data: number[] };               // seconds offset from start_date
}

export function buildGpxFromActivity(activity: StravaActivity, streams: StravaStreams): string {
  const startDate = new Date(activity.start_date);
  const latlng = streams.latlng?.data ?? [];
  const altitudes = streams.altitude?.data ?? [];
  const times = streams.time?.data ?? [];

  const trackpoints = latlng.map(([lat, lon], i) => {
    const elapsedSecs = times[i] ?? i;
    const pointTime = new Date(startDate.getTime() + elapsedSecs * 1000).toISOString();
    const ele = altitudes[i] != null ? `\n        <ele>${altitudes[i].toFixed(1)}</ele>` : "";
    return `      <trkpt lat="${lat.toFixed(8)}" lon="${lon.toFixed(8)}">${ele}\n        <time>${pointTime}</time>\n      </trkpt>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Big Miles"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(activity.name)}</name>
    <time>${activity.start_date}</time>
  </metadata>
  <trk>
    <name>${escapeXml(activity.name)}</name>
    <type>${escapeXml(activity.sport_type)}</type>
    <trkseg>
${trackpoints.join("\n")}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Shared ingestion ─────────────────────────────────────────────────────────

export async function importGpxToInbox(params: {
  userId: string;
  rawGpx: string;
  filename: string;
  source: "strava-activity" | "strava-route";
  stravaId: string;
}): Promise<GpxInboxItem> {
  let gpxStats: any = null;
  try {
    gpxStats = parseGpxData(params.rawGpx);
  } catch (_) { /* stats are best-effort */ }

  return storage.createInboxItem({
    userId: params.userId,
    filename: params.filename,
    rawGpx: params.rawGpx,
    gpxStats,
    source: params.source,
    stravaId: params.stravaId,
  });
}
