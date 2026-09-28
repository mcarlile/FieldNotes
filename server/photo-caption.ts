// Existing photo edits must only touch the caption. In particular, an edit
// payload without EXIF must not clear metadata already stored for the photo.
export function existingPhotoCaptionPatch(photoData: { caption?: unknown }): { altText: string } | null {
  if (typeof photoData.caption === "string") return { altText: photoData.caption };
  if (photoData.caption === null) return { altText: "" };
  return null;
}