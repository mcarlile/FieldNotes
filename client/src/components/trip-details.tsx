import { useMemo, type ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";
import { ExternalLink, Download } from "lucide-react";
import ElevationProfile from "@/components/elevation-profile";
import { parseGpxData, parseGpxWithTimestamps, type ElevationPoint } from "@shared/gpx-utils";
import { buildGpxExport, downloadGpx, gpxFilename } from "@/lib/gpx-export";
import { useToast } from "@/hooks/use-toast";
import type { FieldNote } from "@shared/schema";

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dd className="text-foreground font-medium leading-tight">{value}</dd>
      <dt className="meta-mono text-muted-foreground">{label}</dt>
    </div>
  );
}

interface TripDetailsProps {
  trip: FieldNote;
  /** Called with the point under the pointer on the elevation chart. */
  onHoverElevation: (point: ElevationPoint | null) => void;
  /** Owner-only links (share, edit, delete), after Strava and GPX. */
  actions?: ReactNode;
}

/**
 * The trip card's body: date, stats, elevation chart, description and links.
 * Shared by the trip page and its view-only share link so they match.
 */
export default function TripDetails({ trip, onHoverElevation, actions }: TripDetailsProps) {
  const { toast } = useToast();

  const handleDownloadGpx = () => {
    const gpx = buildGpxExport(trip.gpxData, trip.title, trip.date);
    if (!gpx) {
      toast({ title: "No GPX track", description: "This field note has no route data to export.", variant: "destructive" });
      return;
    }
    downloadGpx(gpx, gpxFilename(trip.title));
    trackEvent("gpx_downloaded");
  };

  const parsedGpxData = useMemo(() => {
    if (!trip.gpxData) return null;
    try {
      if (typeof trip.gpxData === "string") {
        return parseGpxData(trip.gpxData);
      } else if (typeof trip.gpxData === "object") {
        const data = trip.gpxData as any;
        if (data.coordinates && Array.isArray(data.coordinates)) {
          return {
            coordinates: data.coordinates,
            elevationProfile: data.elevationProfile || [],
            distance: trip.distance || 0,
            elevationGain: trip.elevationGain || 0,
          };
        }
      }
    } catch (error) {
      console.error("Failed to parse GPX data for elevation profile:", error);
    }
    return null;
  }, [trip.gpxData, trip.distance, trip.elevationGain]);

  // Derived trip stats from elevation profile + (optional) raw GPX timestamps
  const derivedStats = useMemo(() => {
    const profile = parsedGpxData?.elevationProfile;
    if (!profile || profile.length === 0) return null;

    const elevations = profile
      .map((p: { elevation: number }) => p.elevation)
      .filter((e: number) => Number.isFinite(e));
    if (elevations.length === 0) return null;

    const maxEle = Math.round(Math.max(...elevations));
    const minEle = Math.round(Math.min(...elevations));

    // Peak grade: max % grade between adjacent points (over a smoothing window)
    let peakGrade = 0;
    const window = Math.max(1, Math.floor(profile.length / 200));
    for (let i = window; i < profile.length; i++) {
      const dEle = profile[i].elevation - profile[i - window].elevation; // ft
      const dDist = (profile[i].distance - profile[i - window].distance) * 5280; // mi → ft
      if (dDist > 0) {
        const grade = Math.abs(dEle / dDist) * 100;
        if (grade > peakGrade && grade < 100) peakGrade = grade;
      }
    }

    // Elapsed time: total timestamp span (start → end), only available when raw GPX is present
    let elapsedTime: string | null = null;
    if (typeof trip.gpxData === "string") {
      try {
        const tracked = parseGpxWithTimestamps(trip.gpxData);
        if (tracked.durationSeconds > 0) {
          const total = Math.round(tracked.durationSeconds);
          const h = Math.floor(total / 3600);
          const m = Math.floor((total % 3600) / 60);
          elapsedTime = h > 0 ? `${h}h ${m}m` : `${m}m`;
        }
      } catch (_) { /* ignore */ }
    }

    return { maxEle, minEle, peakGrade: Math.round(peakGrade * 10) / 10, elapsedTime };
  }, [parsedGpxData, trip.gpxData]);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return (
    <div className="space-y-4">
      <div className="meta-mono text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
        {trip.tripType && trip.tripType.length > 0 && (
          <>
            <span>{Array.isArray(trip.tripType) ? trip.tripType.join(', ') : trip.tripType}</span>
            <span>·</span>
          </>
        )}
        <span>{formatDate(trip.date.toString())}</span>
      </div>

      {(trip.distance != null || trip.elevationGain != null || derivedStats) && (
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3" data-testid="trip-stats">
          {trip.distance != null && <Stat label="Miles" value={trip.distance} />}
          {trip.elevationGain != null && <Stat label="Ft gain" value={trip.elevationGain.toLocaleString()} />}
          {derivedStats && <Stat label="Ft max" value={derivedStats.maxEle.toLocaleString()} />}
          {derivedStats && <Stat label="Ft min" value={derivedStats.minEle.toLocaleString()} />}
          {derivedStats && derivedStats.peakGrade > 0 && <Stat label="Peak grade" value={`${derivedStats.peakGrade}%`} />}
          {derivedStats?.elapsedTime && <Stat label="Elapsed" value={derivedStats.elapsedTime} />}
        </dl>
      )}

      {parsedGpxData && parsedGpxData.elevationProfile && parsedGpxData.elevationProfile.length > 0 && (
        <div>
          <div className="meta-mono text-muted-foreground mb-1">Elevation</div>
          <ElevationProfile
            elevationProfile={parsedGpxData.elevationProfile}
            onHoverPoint={onHoverElevation}
            chartClassName="h-36"
            className="w-full -ml-2"
          />
        </div>
      )}

      {trip.description && (
        <p className="font-serif text-foreground leading-relaxed whitespace-pre-line">{trip.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-border">
        {trip.stravaId && (
          <a
            href={`https://www.strava.com/${trip.stravaSource === "strava-route" ? "routes" : "activities"}/${trip.stravaId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="meta-mono text-orange-500 hover:text-orange-600 transition-colors flex items-center gap-1.5 pt-2"
          >
            <ExternalLink className="h-3 w-3" />
            Strava
          </a>
        )}
        {!!trip.gpxData && (
          <button
            onClick={handleDownloadGpx}
            className="meta-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 pt-2"
            data-testid="button-download-gpx"
          >
            <Download className="h-3 w-3" />
            GPX
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}
