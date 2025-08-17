import exifr from 'exifr';
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

export async function extractExifFromBuffer(buffer: Buffer, filename: string): Promise<PhotoExifData> {
  try {
    console.log(`Extracting EXIF data from ${filename} (${Math.round(buffer.length / 1024)} KB)...`);
    
    // Extract EXIF data with proper GPS handling
    const exifData = await exifr.parse(buffer, {
      // Extract GPS and other essential data
      gps: true,
      exif: true,
      iptc: false,
      icc: false,
      xmp: false,
      // Enable proper GPS coordinate translation
      translateKeys: true,
      translateValues: true,
      mergeOutput: true
    });

    if (!exifData) {
      console.log("No EXIF data found in image");
      return {};
    }

    console.log("Raw EXIF data:", exifData);

    const result: PhotoExifData = {};

    // GPS coordinates - try multiple field names
    if (exifData.latitude && exifData.longitude) {
      result.latitude = exifData.latitude;
      result.longitude = exifData.longitude;
    } else if (exifData.GPSLatitude && exifData.GPSLongitude) {
      result.latitude = exifData.GPSLatitude;
      result.longitude = exifData.GPSLongitude;
    }

    // Elevation/altitude - try multiple field names
    if (exifData.GPSAltitude) {
      result.elevation = exifData.GPSAltitude;
    } else if (exifData.elevation) {
      result.elevation = exifData.elevation;
    }

    // Timestamp - try multiple fields
    const timestampFields = [
      exifData.DateTimeOriginal,
      exifData.DateTime,
      exifData.CreateDate,
      exifData.ModifyDate
    ];
    
    for (const timestamp of timestampFields) {
      if (timestamp) {
        result.timestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
        break;
      }
    }

    // Camera information
    if (exifData.Make && exifData.Model) {
      result.camera = `${exifData.Make} ${exifData.Model}`.trim();
    } else if (exifData.Model) {
      result.camera = exifData.Model;
    } else if (exifData.Make) {
      result.camera = exifData.Make;
    }

    // Lens information
    if (exifData.LensModel) {
      result.lens = exifData.LensModel;
    } else if (exifData.LensSpecification) {
      result.lens = Array.isArray(exifData.LensSpecification) 
        ? exifData.LensSpecification.join('-') + 'mm'
        : exifData.LensSpecification.toString();
    }

    // Camera settings
    if (exifData.FNumber) {
      result.aperture = `f/${exifData.FNumber}`;
    } else if (exifData.ApertureValue) {
      result.aperture = `f/${Math.round(Math.pow(2, exifData.ApertureValue / 2) * 10) / 10}`;
    }

    if (exifData.ExposureTime) {
      if (exifData.ExposureTime >= 1) {
        result.shutterSpeed = `${exifData.ExposureTime}s`;
      } else {
        result.shutterSpeed = `1/${Math.round(1/exifData.ExposureTime)}s`;
      }
    } else if (exifData.ShutterSpeedValue) {
      const shutterSpeed = Math.pow(2, -exifData.ShutterSpeedValue);
      if (shutterSpeed >= 1) {
        result.shutterSpeed = `${shutterSpeed}s`;
      } else {
        result.shutterSpeed = `1/${Math.round(1/shutterSpeed)}s`;
      }
    }

    if (exifData.ISO || exifData.ISOSpeedRatings) {
      result.iso = exifData.ISO || exifData.ISOSpeedRatings;
    }

    if (exifData.FocalLength) {
      result.focalLength = `${exifData.FocalLength}mm`;
    }

    // File size
    result.fileSize = `${Math.round(buffer.length / 1024)} KB`;

    console.log("Extracted EXIF data:", result);
    return result;
  } catch (error) {
    console.error("Error extracting EXIF data:", error);
    return {};
  }
}

export async function extractExifData(photoUrl: string): Promise<PhotoExifData> {
  try {
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(photoUrl);
    
    // For large files, only download the first portion that contains EXIF data
    // Most EXIF data is in the first 64KB of a JPEG file
    const fileSize = await objectFile.getMetadata().then(([metadata]) => Number(metadata.size) || 0);
    const downloadSize = Math.min(fileSize, 64 * 1024); // Limit to 64KB for EXIF extraction
    
    console.log(`Downloading ${downloadSize} bytes of ${fileSize} bytes for EXIF extraction from ${photoUrl}`);
    
    // Download only the portion we need for EXIF
    const [buffer] = await objectFile.download({
      start: 0,
      end: downloadSize - 1
    });
    
    // Extract EXIF data from the buffer
    return await extractExifFromBuffer(buffer, objectFile.name);
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