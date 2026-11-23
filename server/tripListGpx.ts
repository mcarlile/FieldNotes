import type { Pool } from "pg";
import { parseGpxData } from "@shared/gpx-utils";

/** The most route points a trip carries in the trips list. */
export const LIST_ROUTE_POINTS = 500;

/**
 * gpxData slimmed for the trips list: just the route's shape, thinned to a few
 * hundred points. Full GPX for every trip (timed tracks, elevation profiles)
 * made the list too big for the production proxy, which answered with an empty
 * 500. The trip page still loads the full gpxData from /api/field-notes/:id.
 */
export function listGpxData(gpxData: unknown): { coordinates: [number, number][] } | null {
  let coordinates: unknown;
  if (typeof gpxData === "string") {
    try {
      coordinates = parseGpxData(gpxData).coordinates;
    } catch {
      try {
        coordinates = JSON.parse(gpxData)?.coordinates;
      } catch {
        return null;
      }
    }
  } else if (gpxData && typeof gpxData === "object") {
    coordinates = (gpxData as { coordinates?: unknown }).coordinates;
  }
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  const points = coordinates as [number, number][];
  if (points.length <= LIST_ROUTE_POINTS) return { coordinates: points };
  const step = (points.length - 1) / (LIST_ROUTE_POINTS - 1);
  return {
    coordinates: Array.from({ length: LIST_ROUTE_POINTS }, (_, i) => points[Math.round(i * step)]),
  };
}

/**
 * Fills field_notes.list_route for trips saved before it existed, a few at a
 * time so the server stays responsive. Trips without a route get [].
 */
export async function backfillListRoutes(pool: Pool, batchSize = 20): Promise<number> {
  let filled = 0;
  for (;;) {
    const { rows } = await pool.query<{ id: string; gpx_data: unknown }>(
      `SELECT id, gpx_data FROM field_notes WHERE list_route IS NULL LIMIT $1`,
      [batchSize],
    );
    if (rows.length === 0) return filled;
    for (const row of rows) {
      const route = listGpxData(row.gpx_data)?.coordinates ?? [];
      await pool.query(`UPDATE field_notes SET list_route = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify(route)]);
      filled += 1;
    }
  }
}
