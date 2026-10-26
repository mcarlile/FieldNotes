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
