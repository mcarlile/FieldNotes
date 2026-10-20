// Builds a downloadable GPX file from a field note's stored gpxData.
// gpxData is either the raw GPX string (uploaded via the edit form) or an
// object with [longitude, latitude] coordinates (imported from the inbox/Strava).

interface StoredTrack {
  coordinates?: [number, number][];
  elevationProfile?: { elevation: number }[]; // feet
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildGpxExport(gpxData: unknown, name: string, date?: Date | string | null): string | null {
  if (typeof gpxData === "string") {
    return gpxData.trim() ? gpxData : null;
  }
  if (!gpxData || typeof gpxData !== "object") return null;

  const track = gpxData as StoredTrack;
  const coordinates = Array.isArray(track.coordinates) ? track.coordinates : [];
  if (coordinates.length === 0) return null;

  // Elevation profile points line up with coordinates only when the lengths match.
  const profile = Array.isArray(track.elevationProfile) && track.elevationProfile.length === coordinates.length
    ? track.elevationProfile
    : null;

  const safeName = escapeXml(name);
  const time = date ? new Date(date) : null;
  const metadataTime = time && !isNaN(time.getTime()) ? `\n    <time>${time.toISOString()}</time>` : "";

  const points = coordinates.map(([lon, lat], i) => {
    const ele = profile ? `<ele>${(profile[i].elevation / 3.28084).toFixed(1)}</ele>` : "";
    return `      <trkpt lat="${lat}" lon="${lon}">${ele}</trkpt>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FieldNotes" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>${metadataTime}
  </metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${points.join("\n")}
    </trkseg>
  </trk>
</gpx>
`;
}

export function gpxFilename(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "field-note"}.gpx`;
}

export function downloadGpx(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
