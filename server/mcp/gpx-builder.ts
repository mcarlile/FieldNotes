/**
 * Build a GPX XML string from a structured track.
 * Compatible with parseGpxData() in shared/gpx-utils.ts.
 */

/** [latitude, longitude, elevation_meters | null, iso_time | null] */
export type TrackPoint = [number, number, number | null, string | null];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function validatePoint(p: TrackPoint, idx: number): void {
  const [lat, lon, ele] = p;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90)
    throw new Error(`Point ${idx}: latitude ${lat} out of range`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180)
    throw new Error(`Point ${idx}: longitude ${lon} out of range`);
  if (ele !== null && ele !== undefined && !Number.isFinite(ele))
    throw new Error(`Point ${idx}: elevation must be a finite number or null`);
}

export function buildGpxXml(trackName: string, points: TrackPoint[]): string {
  if (points.length < 2)
    throw new Error("A track requires at least 2 points");

  const trkpts = points
    .map((p, i) => {
      validatePoint(p, i);
      const [lat, lon, ele, time] = p;
      const lines = [`      <trkpt lat="${lat}" lon="${lon}">`];
      if (ele !== null && ele !== undefined && Number.isFinite(ele))
        lines.push(`        <ele>${ele}</ele>`);
      if (time) lines.push(`        <time>${time}</time>`);
      lines.push(`      </trkpt>`);
      return lines.join("\n");
    })
    .join("\n");

  const safeName = escapeXml(trackName || "Track");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FieldNotes MCP" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${safeName}</name></metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}
