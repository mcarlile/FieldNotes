import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Mountain, Ruler, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import MapboxMap from "@/components/mapbox-map";
import PhotoLightbox from "@/components/photo-lightbox";
import { parseGpxData } from "@shared/gpx-utils";
import type { FieldNote, Photo, Expedition } from "@shared/schema";

interface PublicFieldNote extends FieldNote {
  photos: Photo[];
  position: number;
}

interface PublicExpedition extends Expedition {
  fieldNotes: PublicFieldNote[];
}

function formatMiles(km: number | null): string {
  if (!km) return "—";
  return `${(km * 0.621371).toFixed(1)} mi`;
}

function formatFeet(m: number | null): string {
  if (!m) return "—";
  return `${Math.round(m * 3.28084).toLocaleString()} ft`;
}

function DayCard({ note, index, onPhotoClick }: {
  note: PublicFieldNote;
  index: number;
  onPhotoClick: (photoId: string, photos: Photo[]) => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);

  const gpxCoords = useMemo(() => {
    if (!note.gpxData) return null;
    try {
      const data = note.gpxData as any;
      if (data.coordinates) return data.coordinates as [number, number][];
      if (typeof data === "string") return parseGpxData(data).coordinates;
    } catch {}
    return null;
  }, [note.gpxData]);

  const dateStr = new Date(note.date).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 bg-stone-50 hover:bg-stone-100 transition-colors text-left"
      >
        <div>
          <span className="text-xs font-mono text-stone-400 uppercase tracking-wider">Day {index + 1}</span>
          <h3 className="font-serif text-stone-800 mt-0.5">{note.title}</h3>
          <p className="text-xs text-stone-400 mt-0.5">{dateStr}</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono text-stone-500">
            {note.distance && <span>{formatMiles(note.distance)}</span>}
            {note.elevationGain && <span>↑ {formatFeet(note.elevationGain)}</span>}
          </div>
          {expanded ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
        </div>
      </button>

      {expanded && (
        <div className="p-5 space-y-5">
          {gpxCoords && gpxCoords.length > 0 && (
            <div className="h-48 rounded-lg overflow-hidden">
              <MapboxMap
                coordinates={gpxCoords}
                photoMarkers={note.photos
                  .filter(p => p.latitude && p.longitude)
                  .map(p => ({ id: p.id, latitude: p.latitude!, longitude: p.longitude! }))}
                height="100%"
              />
            </div>
          )}

          {note.description && (
            <p className="text-stone-600 leading-relaxed">{note.description}</p>
          )}

          {note.photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {note.photos.map(photo => (
                <button
                  key={photo.id}
                  onClick={() => onPhotoClick(photo.id, note.photos)}
                  className="aspect-square bg-stone-100 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
                >
                  <img
                    src={photo.url}
                    alt={photo.filename}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PublicExpeditionPage() {
  const { slug } = useParams<{ slug: string }>();
  const [lightbox, setLightbox] = useState<{ photoId: string; photos: Photo[] } | null>(null);

  const { data: expedition, isLoading, error } = useQuery<PublicExpedition>({
    queryKey: ["/api/public/expeditions", slug],
    queryFn: () => fetch(`/api/public/expeditions/${slug}`).then(async r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !!slug,
    retry: false,
  });

  const allCoords = useMemo(() => {
    if (!expedition) return [];
    return expedition.fieldNotes.flatMap(fn => {
      const data = fn.gpxData as any;
      if (!data) return [];
      try {
        if (data.coordinates) return data.coordinates as [number, number][];
        if (typeof data === "string") return parseGpxData(data).coordinates;
      } catch {}
      return [];
    });
  }, [expedition]);

  const totalDistance = useMemo(() => {
    if (!expedition) return null;
    const sum = expedition.fieldNotes.reduce((acc, fn) => acc + (fn.distance ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [expedition]);

  const totalElevation = useMemo(() => {
    if (!expedition) return null;
    const sum = expedition.fieldNotes.reduce((acc, fn) => acc + (fn.elevationGain ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [expedition]);

  const dateRange = useMemo(() => {
    if (!expedition || expedition.fieldNotes.length === 0) return null;
    const dates = expedition.fieldNotes.map(fn => new Date(fn.date)).sort((a, b) => a.getTime() - b.getTime());
    const first = dates[0].toLocaleDateString("en-US", { month: "long", day: "numeric" });
    const last = dates[dates.length - 1].toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    return dates.length > 1 ? `${first} – ${last}` : last;
  }, [expedition]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !expedition) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] flex flex-col items-center justify-center gap-4">
        <Mountain size={40} className="text-stone-300" />
        <p className="font-serif text-xl text-stone-500">This expedition isn't available</p>
        <p className="text-sm text-stone-400">It may have been unpublished or the link is incorrect.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F0E8]">
      {/* Header */}
      <div className="border-b border-stone-200 bg-[#F5F0E8]/90 backdrop-blur-sm sticky top-0 z-10 px-6 py-3">
        <p className="text-xs font-mono text-stone-400 uppercase tracking-widest">Big Miles</p>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl text-stone-800 mb-2">{expedition.title}</h1>
          {expedition.description && (
            <p className="text-stone-500 text-lg leading-relaxed">{expedition.description}</p>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap gap-6 mt-5">
            {dateRange && (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Calendar size={14} />
                <span className="font-mono">{dateRange}</span>
              </div>
            )}
            {expedition.fieldNotes.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <span className="font-mono">{expedition.fieldNotes.length} day{expedition.fieldNotes.length !== 1 ? "s" : ""}</span>
              </div>
            )}
            {totalDistance && (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Ruler size={14} />
                <span className="font-mono">{formatMiles(totalDistance)} total</span>
              </div>
            )}
            {totalElevation && (
              <div className="flex items-center gap-2 text-sm text-stone-500">
                <Mountain size={14} />
                <span className="font-mono">↑ {formatFeet(totalElevation)} total</span>
              </div>
            )}
          </div>
        </div>

        {/* Combined map */}
        {allCoords.length > 0 && (
          <div className="h-72 sm:h-96 rounded-xl overflow-hidden border border-stone-200">
            <MapboxMap coordinates={allCoords} height="100%" />
          </div>
        )}

        {/* Day cards */}
        {expedition.fieldNotes.length > 0 && (
          <div className="space-y-3">
            {expedition.fieldNotes.map((fn, i) => (
              <DayCard
                key={fn.id}
                note={fn}
                index={i}
                onPhotoClick={(photoId, photos) => setLightbox({ photoId, photos })}
              />
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <PhotoLightbox
          photoId={lightbox.photoId}
          photos={lightbox.photos}
          onClose={() => setLightbox(null)}
          onPhotoChange={photoId => setLightbox(l => l ? { ...l, photoId } : null)}
        />
      )}
    </div>
  );
}
