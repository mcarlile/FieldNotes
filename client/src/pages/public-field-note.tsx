import { useState, useMemo } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Mountain } from "lucide-react";
import MapboxMap from "@/components/mapbox-map";
import PhotoLightbox from "@/components/photo-lightbox";
import ElevationProfile from "@/components/elevation-profile";
import { parseGpxData } from "@shared/gpx-utils";
import type { FieldNote, Photo } from "@shared/schema";

interface PublicFieldNote extends FieldNote {
  photos: Photo[];
}

function formatMiles(km: number | null): string {
  if (!km) return "—";
  return `${(km * 0.621371).toFixed(1)} mi`;
}

function formatFeet(m: number | null): string {
  if (!m) return "—";
  return `${Math.round(m * 3.28084).toLocaleString()} ft`;
}

export default function PublicFieldNotePage() {
  const { slug } = useParams<{ slug: string }>();
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  const { data: note, isLoading, error } = useQuery<PublicFieldNote>({
    queryKey: ["/api/public/field-notes", slug],
    queryFn: () => fetch(`/api/public/field-notes/${slug}`).then(async r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !!slug,
    retry: false,
  });

  const parsedGpx = useMemo(() => {
    if (!note?.gpxData) return null;
    try {
      const data = note.gpxData as any;
      if (data.coordinates) return data;
      if (typeof data === "string") return parseGpxData(data);
    } catch {}
    return null;
  }, [note?.gpxData]);

  const photoMarkers = useMemo(() =>
    (note?.photos ?? [])
      .filter(p => p.latitude && p.longitude)
      .map(p => ({ id: p.id, latitude: p.latitude!, longitude: p.longitude! })),
    [note?.photos]
  );

  const tripTypes = Array.isArray(note?.tripType) ? note!.tripType : [];
  const dateStr = note
    ? new Date(note.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : "";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="min-h-screen bg-[#F5F0E8] flex flex-col items-center justify-center gap-4">
        <Mountain size={40} className="text-stone-300" />
        <p className="font-serif text-xl text-stone-500">This field note isn't available</p>
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

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        {/* Title + meta */}
        <div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tripTypes.map(t => (
              <span key={t} className="px-2 py-0.5 text-xs font-mono bg-stone-200 text-stone-600 rounded capitalize">
                {t}
              </span>
            ))}
          </div>
          <h1 className="font-serif text-3xl text-stone-800 mb-1">{note.title}</h1>
          <p className="text-sm font-mono text-stone-400">{dateStr}</p>
        </div>

        {/* Stats */}
        {(note.distance || note.elevationGain) && (
          <div className="flex gap-8 px-5 py-4 bg-white/60 border border-stone-200 rounded-xl">
            {note.distance && (
              <div>
                <p className="text-xl font-bold text-stone-800">{formatMiles(note.distance)}</p>
                <p className="text-xs font-mono text-stone-400 uppercase tracking-wider">Distance</p>
              </div>
            )}
            {note.elevationGain && (
              <div>
                <p className="text-xl font-bold text-stone-800">{formatFeet(note.elevationGain)}</p>
                <p className="text-xs font-mono text-stone-400 uppercase tracking-wider">Elevation gain</p>
              </div>
            )}
          </div>
        )}

        {/* Map */}
        {parsedGpx?.coordinates?.length > 0 && (
          <div className="h-72 rounded-xl overflow-hidden border border-stone-200">
            <MapboxMap
              coordinates={parsedGpx.coordinates}
              photoMarkers={photoMarkers}
              height="100%"
            />
          </div>
        )}

        {/* Elevation profile */}
        {parsedGpx?.elevationProfile?.length > 0 && (
          <ElevationProfile
            elevationProfile={parsedGpx.elevationProfile}
            onHoverPoint={() => {}}
          />
        )}

        {/* Description */}
        {note.description && (
          <p className="text-stone-600 leading-relaxed text-base">{note.description}</p>
        )}

        {/* Photos */}
        {note.photos.length > 0 && (
          <div>
            <p className="text-xs font-mono text-stone-400 uppercase tracking-wider mb-3">
              Photos ({note.photos.length})
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {note.photos.map(photo => (
                <button
                  key={photo.id}
                  onClick={() => setSelectedPhotoId(photo.id)}
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
          </div>
        )}
      </div>

      {selectedPhotoId && (
        <PhotoLightbox
          photoId={selectedPhotoId}
          photos={note.photos}
          onClose={() => setSelectedPhotoId(null)}
          onPhotoChange={setSelectedPhotoId}
        />
      )}
    </div>
  );
}
