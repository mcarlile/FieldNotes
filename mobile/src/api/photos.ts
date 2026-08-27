import { apiJson } from "./client";

export interface UploadAsset {
  uri: string;
  filename: string;
  mimeType: string;
}

export async function uploadPhoto(fieldNoteId: string, asset: UploadAsset): Promise<void> {
  // Step 1: Get a presigned GCS upload URL
  const { uploadURL } = await apiJson<{ uploadURL: string }>("/api/photos/upload", "POST");

  // Step 2: Read the local file and PUT directly to GCS
  const fileRes = await fetch(asset.uri);
  const blob = await fileRes.blob();

  const gcsRes = await fetch(uploadURL, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": asset.mimeType },
  });
  if (!gcsRes.ok) throw new Error(`GCS upload failed (${gcsRes.status})`);

  // Step 3: Create the photo record in the DB (server extracts EXIF async)
  await apiJson("/api/photos", "POST", {
    fieldNoteId,
    url: uploadURL,
    filename: asset.filename,
  });
}
