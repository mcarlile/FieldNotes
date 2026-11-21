import { useRef } from "react";
import { Film, ImagePlus, X } from "lucide-react";
import { isPhotoFile, isVideoFile, requestUploadNotifications } from "@/lib/trip-media-uploads";

interface TripMediaPickerProps {
  photos?: File[];
  onPhotosChange?: (files: File[]) => void;
  videos: File[];
  onVideosChange: (files: File[]) => void;
  className?: string;
}

const pillClass =
  "meta-mono inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function sizeLabel(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * Photos and videos to add to a trip that is being created. Nothing uploads
 * here: the files go up in the background once the trip is saved.
 */
export function TripMediaPicker({ photos, onPhotosChange, videos, onVideosChange, className }: TripMediaPickerProps) {
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const pick = (event: React.ChangeEvent<HTMLInputElement>, kind: "photo" | "video") => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (kind === "video") {
      const picked = files.filter(isVideoFile);
      if (picked.length) {
        requestUploadNotifications();
        onVideosChange([...videos, ...picked]);
      }
    } else if (photos && onPhotosChange) {
      onPhotosChange([...photos, ...files.filter(isPhotoFile)]);
    }
  };

  const rows = [
    ...(photos ?? []).map((file, index) => ({ file, kind: "photo" as const, index })),
    ...videos.map((file, index) => ({ file, kind: "video" as const, index })),
  ];

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {onPhotosChange && (
          <button type="button" className={pillClass} onClick={() => photoInput.current?.click()} data-testid="button-pick-photos">
            <ImagePlus className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            Add photos
          </button>
        )}
        <button type="button" className={pillClass} onClick={() => videoInput.current?.click()} data-testid="button-pick-videos">
          <Film className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          Add videos
        </button>
      </div>
      <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => pick(e, "photo")} />
      <input ref={videoInput} type="file" accept="video/*" multiple className="hidden" onChange={(e) => pick(e, "video")} />

      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {rows.map(({ file, kind, index }) => (
            <li key={`${kind}-${index}-${file.name}`} className="flex items-center gap-3 py-2 text-sm">
              {kind === "video"
                ? <Film className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                : <ImagePlus className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate text-foreground" title={file.name}>{file.name}</span>
              <span className="meta-mono shrink-0 text-muted-foreground">{sizeLabel(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() =>
                  kind === "video"
                    ? onVideosChange(videos.filter((_, i) => i !== index))
                    : onPhotosChange?.((photos ?? []).filter((_, i) => i !== index))
                }
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {videos.length > 0 && (
        <p className="meta-mono mt-2 text-muted-foreground">
          Videos upload in the background after you save. You'll get a notification when they're up.
        </p>
      )}
    </div>
  );
}
