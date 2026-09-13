type AnalyticsData = Record<string, string | number | boolean>;

type AnalyticsEvent =
  | "field_note_created"
  | "field_note_updated"
  | "field_note_deleted"
  | "strava_import_completed"
  | "expedition_saved"
  | "expedition_deleted"
  | "content_published"
  | "content_unpublished"
  | "public_link_copied";

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void | Promise<unknown>;
    };
  }
}

// The publishing proxy supplies the tracker. Never send IDs, titles,
// descriptions, coordinates, URLs, or other private content as event data.
export function trackEvent(name: AnalyticsEvent, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;
  try {
    const result = window.umami?.track(name, data);
    if (result) void Promise.resolve(result).catch(() => {});
  } catch {
    // Analytics failures must not affect the action being measured.
  }
}