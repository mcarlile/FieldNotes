// Client-side EXIF extraction utility using exifr library
// This handles extracting GPS coordinates and timestamps from uploaded photos

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

declare global {
  interface Window {
    exifr: any;
  }
}

export async function extractExifFromFile(file: File): Promise<PhotoExifData> {
  try {
    // Dynamically import exifr
    const exifr = await import('exifr');
    
    // Extract EXIF data
    const exifData = await exifr.parse(file, true);

    if (!exifData) {
      console.log("No EXIF data found in image");
      return {};
    }

    const result: PhotoExifData = {};

    // Extract GPS coordinates
    if (exifData.latitude && exifData.longitude) {
      result.latitude = exifData.latitude;
      result.longitude = exifData.longitude;
    }

    // Extract altitude/elevation
    if (exifData.GPSAltitude) {
      result.elevation = exifData.GPSAltitude;
    }

    // Extract timestamp
    if (exifData.DateTimeOriginal) {
      result.timestamp = new Date(exifData.DateTimeOriginal);
    } else if (exifData.DateTime) {
      result.timestamp = new Date(exifData.DateTime);
    } else if (exifData.CreateDate) {
      result.timestamp = new Date(exifData.CreateDate);
    }

    // Extract camera information
    if (exifData.Make && exifData.Model) {
      result.camera = `${exifData.Make} ${exifData.Model}`;
    } else if (exifData.Model) {
      result.camera = exifData.Model;
    }

    // Extract lens information
    if (exifData.LensModel) {
      result.lens = exifData.LensModel;
    } else if (exifData.LensMake && exifData.LensModel) {
      result.lens = `${exifData.LensMake} ${exifData.LensModel}`;
    }

    // Extract aperture
    if (exifData.FNumber) {
      result.aperture = `f/${exifData.FNumber}`;
    }

    // Extract shutter speed
    if (exifData.ExposureTime) {
      if (exifData.ExposureTime < 1) {
        result.shutterSpeed = `1/${Math.round(1 / exifData.ExposureTime)}`;
      } else {
        result.shutterSpeed = `${exifData.ExposureTime}s`;
      }
    }

    // Extract ISO
    if (exifData.ISO) {
      result.iso = exifData.ISO;
    }

    // Extract focal length
    if (exifData.FocalLength) {
      result.focalLength = `${exifData.FocalLength}mm`;
    }

    // Extract file size
    result.fileSize = formatFileSize(file.size);

    console.log("Extracted EXIF data:", result);
    return result;

  } catch (error) {
    console.error("Error extracting EXIF data:", error);
    return {};
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}