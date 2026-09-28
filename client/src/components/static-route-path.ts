// GPX and GeoJSON coordinates are [longitude, latitude]; encoded polylines are latitude first.
export type RouteCoordinate = [number, number];

export function validRouteCoordinates(value: unknown): RouteCoordinate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((point): point is RouteCoordinate =>
    Array.isArray(point) &&
    point.length >= 2 &&
    typeof point[0] === "number" &&
    typeof point[1] === "number" &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[0] >= -180 && point[0] <= 180 &&
    point[1] >= -90 && point[1] <= 90
  );
}

export function simplifyRouteCoordinates(points: RouteCoordinate[], maxPoints = 100): RouteCoordinate[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new RangeError("A route needs a point limit of at least two");
  }
  if (points.length <= maxPoints) return points;
  return Array.from({ length: maxPoints }, (_, i) =>
    points[Math.floor(i * (points.length - 1) / (maxPoints - 1))]
  );
}

export function encodeRoutePolyline(points: RouteCoordinate[]): string {
  let previousLat = 0;
  let previousLng = 0;
  let result = "";

  function encodeDelta(delta: number): string {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    let encoded = "";
    while (value >= 0x20) {
      encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>>= 5;
    }
    return encoded + String.fromCharCode(value + 63);
  }

  for (const [lng, lat] of points) {
    const scaledLat = Math.round(lat * 1e5);
    const scaledLng = Math.round(lng * 1e5);
    result += encodeDelta(scaledLat - previousLat);
    result += encodeDelta(scaledLng - previousLng);
    previousLat = scaledLat;
    previousLng = scaledLng;
  }
  return result;
}

export function staticRoutePath(points: RouteCoordinate[], width: number): string | null {
  if (points.length < 2) return null;
  const encoded = encodeRoutePolyline(simplifyRouteCoordinates(points));
  // encodeURIComponent leaves parentheses unescaped, which would terminate the Mapbox path overlay.
  const safePolyline = encodeURIComponent(encoded).replace(/[!'()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `path-${width}+1a1815-0.85(${safePolyline})`;
}