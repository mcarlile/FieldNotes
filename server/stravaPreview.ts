import type { StravaConnection } from "@shared/schema";

// Deliberately has no dependency on the live Strava client or any storage writes.
type ConnectionReader = (userId: string) => Promise<StravaConnection | undefined>;
export class StravaPreviewError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function isStravaPreviewPath(path: string) {
  return ["/api/strava/status", "/api/strava/activities", "/api/strava/routes"].includes(path);
}

export async function readStravaPreview(
  path: string,
  userId: string,
  getConnection: ConnectionReader,
  request: typeof fetch = fetch,
  now = Date.now(),
) {
  // Check before looking up credentials; never accept an arbitrary Strava URL.
  if (!isStravaPreviewPath(path)) return undefined;
  const conn = await getConnection(userId);
  const connected = !!(conn?.userId === userId && conn.accessToken && conn.stravaAthleteId);
  const available = connected && !!conn?.expiresAt && conn.expiresAt > Math.floor(now / 1000) + 60;
  const unavailable = "Strava preview unavailable: authorization has expired or is missing. Read-only preview will not refresh it; open the live app to renew it.";
  if (path === "/api/strava/status") {
    return {
      state: connected ? "connected" : "disconnected",
      connected,
      stravaAthleteId: connected ? conn!.stravaAthleteId : undefined,
      previewAvailable: available,
      previewMessage: connected && !available ? unavailable : undefined,
    };
  }
  if (!connected) throw new StravaPreviewError(409, "No Strava connection for this production account.");
  if (!available) throw new StravaPreviewError(409, unavailable);
  const endpoint = path === "/api/strava/activities"
    ? "/athlete/activities?per_page=30"
    : `/athletes/${conn!.stravaAthleteId}/routes?per_page=30`;
  let response: Response;
  try {
    response = await request(`https://www.strava.com/api/v3${endpoint}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${conn!.accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new StravaPreviewError(503, "Strava preview is temporarily unavailable. No credentials were changed.");
  }
  // Never retry a rejected token, refresh it, or return upstream error bodies.
  if (!response.ok) {
    throw new StravaPreviewError(
      response.status === 401 || response.status === 403 ? 409 : 503,
      response.status === 401 || response.status === 403 ? unavailable
        : response.status === 429 ? "Strava preview rate limit reached. Try again later."
          : "Strava preview is temporarily unavailable.",
    );
  }
  const fields = path === "/api/strava/activities"
    ? ["id", "name", "sport_type", "start_date", "distance", "total_elevation_gain"]
    : ["id", "name", "type", "distance", "elevation_gain"];
  try {
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("Invalid feed");
    return rows.map(row => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid row");
      return Object.fromEntries(fields.map(key => {
        const value = row[key];
        if (value != null && typeof value !== "string" && typeof value !== "number") throw new Error("Invalid field");
        return [key, value];
      }));
    });
  } catch {
    throw new StravaPreviewError(503, "Strava returned an invalid preview feed.");
  }
}