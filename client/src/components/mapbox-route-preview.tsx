import { useMemo } from "react";
import type { FieldNote } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";

interface MapboxRoutePreviewProps {
  fieldNote: FieldNote;
  className?: string;
}

function buildStaticMapUrl(fieldNote: FieldNote): string | null {
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (!token || !fieldNote.gpxData) return null;

  let coordinates: [number, number][] = [];
  try {
    if (typeof fieldNote.gpxData === "string") {
      coordinates = parseGpxData(fieldNote.gpxData).coordinates;
    } else if (fieldNote.gpxData && typeof fieldNote.gpxData === "object") {
      const obj = fieldNote.gpxData as any;
      if (Array.isArray(obj.coordinates)) coordinates = obj.coordinates;
    }
  } catch {
    return null;
  }

  if (coordinates.length < 2) return null;

  // Reduce to max 100 points to stay within URL length limits
  const step = Math.max(1, Math.floor(coordinates.length / 100));
  const simplified = coordinates.filter((_, i) => i % step === 0);

  const pathCoords = simplified.map(([lng, lat]) => `${lng},${lat}`).join(",");
  // Dark stroke matching app theme, auto-fit bbox
  const path = `path-2+1a1815-0.85(${encodeURIComponent(pathCoords)})`;

  return `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${path}/auto/400x400@2x?access_token=${token}`;
}

export default function MapboxRoutePreview({ fieldNote, className = "" }: MapboxRoutePreviewProps) {
  const staticUrl = useMemo(() => buildStaticMapUrl(fieldNote), [fieldNote.id, fieldNote.gpxData]);

  if (!staticUrl) {
    return (
      <div className={`bg-muted flex items-center justify-center text-muted-foreground text-sm font-ibm ${className}`}>
        No Route Data
      </div>
    );
  }

  return (
    <img
      src={staticUrl}
      alt={`Route map for ${fieldNote.title}`}
      className={`object-cover ${className}`}
      loading="lazy"
      data-testid="mapbox-route-preview"
      onError={(e) => {
        const el = e.currentTarget;
        el.style.display = "none";
        const parent = el.parentElement;
        if (parent) {
          parent.classList.add("bg-muted");
        }
      }}
    />
  );
}
