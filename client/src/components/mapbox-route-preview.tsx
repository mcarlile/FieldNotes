import { useEffect, useMemo, useState } from "react";
import type { FieldNote } from "@shared/schema";
import { parseGpxData } from "@shared/gpx-utils";
import { staticRoutePath, validRouteCoordinates } from "./static-route-path";

type RouteSource = Pick<FieldNote, "id" | "title" | "gpxData">;

interface MapboxRoutePreviewProps {
  fieldNote: RouteSource;
  className?: string;
}

function buildStaticMapUrl(fieldNote: RouteSource): string | null {
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (!token || !fieldNote.gpxData) return null;

  let coordinates: unknown = [];
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

  const path = staticRoutePath(validRouteCoordinates(coordinates), 2);
  if (!path) return null;

  return `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/${path}/auto/400x400@2x?access_token=${encodeURIComponent(token)}`;
}

export default function MapboxRoutePreview({ fieldNote, className = "" }: MapboxRoutePreviewProps) {
  const staticUrl = useMemo(() => buildStaticMapUrl(fieldNote), [fieldNote.id, fieldNote.gpxData]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => setFailedUrl(null), [staticUrl]);

  if (!staticUrl || failedUrl === staticUrl) {
    return (
      <div className={`bg-muted flex items-center justify-center text-muted-foreground text-sm font-sans ${className}`}>
        {staticUrl ? "Map preview unavailable" : "No Route Data"}
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
      onError={() => setFailedUrl(staticUrl)}
    />
  );
}
