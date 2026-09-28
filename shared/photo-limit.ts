export const MAX_TRIP_PHOTOS = 100;

// Legacy trips above the limit may save metadata or remove photos, but cannot add more.
export function validateTripPhotos(
  photos: unknown,
  existingIds: readonly string[] = [],
): string | null {
  if (photos === undefined) return null;
  if (!Array.isArray(photos)) return "Photos must be an array";
  const existing = new Set(existingIds);
  const ids = photos.map((photo) =>
    photo && typeof photo === "object" && "id" in photo ? (photo as { id: unknown }).id : undefined
  );
  if (ids.some((id) => id !== undefined && (typeof id !== "string" || !existing.has(id)))) {
    return "Photos contain an unknown existing photo ID";
  }
  if (ids.filter((id) => id !== undefined).length !== new Set(ids.filter((id) => id !== undefined)).size) {
    return "Photos contain duplicate IDs";
  }
  if (photos.length > MAX_TRIP_PHOTOS &&
      !(existingIds.length > MAX_TRIP_PHOTOS &&
        photos.length <= existingIds.length &&
        ids.every((id) => typeof id === "string" && existing.has(id)))) {
    return `A trip can have at most ${MAX_TRIP_PHOTOS} photos`;
  }
  return null;
}