import { ObjectStorageService } from "./objectStorage";

// EXIF extraction functionality
export interface PhotoExifData {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timestamp?: Date;
  camera?: string;
  lens?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: number;
  focalLength?: string;
  fileSize?: string;
}

export async function extractExifData(photoUrl: string): Promise<PhotoExifData> {
  try {
    // For now, return empty data since we need to handle this client-side
    // due to EXIF data extraction requiring access to the actual file bytes
    return {};
  } catch (error) {
    console.error("Error extracting EXIF data:", error);
    return {};
  }
}

export function convertDMSToDD(degrees: number, minutes: number, seconds: number, direction: string): number {
  let dd = degrees + (minutes / 60) + (seconds / 3600);
  if (direction === 'S' || direction === 'W') {
    dd = dd * -1;
  }
  return dd;
}