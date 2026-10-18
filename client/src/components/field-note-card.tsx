import { Link } from "wouter";
import type { FieldNote } from "@shared/schema";
import MapboxRoutePreview from "./mapbox-route-preview";

interface FieldNoteWithPhotoCount extends FieldNote {
  photoCount?: number;
}

interface FieldNoteCardProps {
  fieldNote: FieldNoteWithPhotoCount;
  searchTerm?: string;
  compact?: boolean;
}

const highlightText = (text: string, searchTerm?: string): React.ReactNode => {
  if (!searchTerm || !text) return text;
  const regex = new RegExp(`(${searchTerm})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, index) =>
    regex.test(part) ? (
      <span
        key={index}
        className="px-0.5"
        style={{ backgroundColor: "var(--support-warning)", color: "var(--foreground)" }}
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
};

// Slight, deterministic height variation to give the masonry a curated feel.
const aspectFor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const variants = ["4 / 5", "3 / 4", "1 / 1", "5 / 6", "4 / 3"];
  return variants[hash % variants.length];
};

export default function FieldNoteCard({ fieldNote, searchTerm, compact = false }: FieldNoteCardProps) {
  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const aspect = aspectFor(fieldNote.id);

  return (
    <Link
      href={`/field-notes/${fieldNote.id}`}
      className={`group block break-inside-avoid cursor-pointer ${compact ? "mb-3" : "mb-4"}`}
    >
      {/* Map fills the tile, no chrome */}
      <div
        className="w-full overflow-hidden bg-muted"
        style={{ aspectRatio: compact ? "1 / 1" : aspect }}
      >
        <MapboxRoutePreview fieldNote={fieldNote} className="w-full h-full" />
      </div>

      {/* Title and metadata remain visible on every card. */}
      <div className={`${compact ? "pt-1.5" : "pt-2"} pb-1`}>
        <div className="meta-mono text-muted-foreground mb-1">
          {highlightText(Array.isArray(fieldNote.tripType) ? fieldNote.tripType.join(', ') : fieldNote.tripType, searchTerm)}
        </div>
        <h3
          className="font-serif text-foreground leading-tight"
          style={{ fontSize: "1.05rem" }}
        >
          {highlightText(fieldNote.title, searchTerm)}
        </h3>
        <div className="meta-mono text-muted-foreground mt-1 flex flex-wrap gap-x-2">
          {fieldNote.distance != null && <span>{fieldNote.distance} mi</span>}
          {fieldNote.distance != null && fieldNote.elevationGain != null && <span>·</span>}
          {fieldNote.elevationGain != null && <span>{fieldNote.elevationGain} ft</span>}
          {(fieldNote.distance != null || fieldNote.elevationGain != null) && <span>·</span>}
          <span>{formatDate(fieldNote.date.toString())}</span>
        </div>
      </div>
    </Link>
  );
}
