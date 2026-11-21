import { Link } from "wouter";
import { Loader2, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { dismissFinishedUploads, useTripMediaUploads } from "@/lib/trip-media-uploads";

/**
 * A small card in the corner while a new trip's photos and videos upload,
 * shown on every page so the uploads can be followed after the dialog closes.
 */
export function TripMediaUploadStatus() {
  const items = useTripMediaUploads();
  if (items.length === 0) return null;

  const active = items.some((i) => i.status === "queued" || i.status === "uploading");
  const total = items.reduce((sum, i) => sum + i.file.size, 0);
  const loaded = items.reduce((sum, i) => sum + (i.status === "done" ? i.file.size : i.loaded), 0);
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error");
  const trips = Array.from(new Map(items.map((i) => [i.tripId, i.tripTitle])).entries());

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-4 shadow-lg"
      data-testid="trip-media-upload-status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {active && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {active ? `Uploading · ${done} of ${items.length} done` : `${done} of ${items.length} uploaded`}
          </div>
          <div className="meta-mono mt-1 truncate text-muted-foreground">
            {trips.map(([id, title], index) => (
              <span key={id}>
                {index > 0 && ", "}
                <Link href={`/field-notes/${id}`} className="hover:text-foreground hover:underline">{title}</Link>
              </span>
            ))}
          </div>
        </div>
        {!active && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissFinishedUploads}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {active && <Progress value={total ? (loaded / total) * 100 : 0} className="mt-3 h-1.5" />}
      {failed.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-destructive">
          {failed.map((i) => (
            <li key={i.id} className="truncate" title={i.error}>{i.file.name}: {i.error}</li>
          ))}
        </ul>
      )}
      {active && <p className="mt-2 text-xs text-muted-foreground">Keep this tab open until they finish. Videos play once processing is done.</p>}
    </div>
  );
}
