import { DOMParser as XmlDomParser } from "xmldom";

const getDOMParser = (): typeof XmlDomParser => {
  if (typeof window !== 'undefined' && window.DOMParser) {
    return window.DOMParser as unknown as typeof XmlDomParser;
  }
  return XmlDomParser;
};

export interface GpxStats {
  distance: number; // in miles
  elevationGain: number; // in feet
  date: Date | null; // extracted from GPX metadata or track points
  coordinates: [number, number][];
  elevationProfile: ElevationPoint[];
}

export interface ElevationPoint {
  distance: number; // cumulative distance in miles
  elevation: number; // elevation in feet
  coordinates: [number, number]; // [longitude, latitude]
}

export interface TimedTrackPoint {
  timestamp: number; // Unix timestamp in milliseconds
  offsetSeconds: number; // Seconds from track start
  latitude: number;
  longitude: number;
  elevation?: number; // Elevation in meters
}

export interface TrackWithTimestamps {
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number;
  points: TimedTrackPoint[];
}

/**
 * Calculates the distance between two GPS coordinates using the Haversine formula
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Converts meters to feet
 */
function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

/**
 * Parses GPX content and extracts distance, elevation gain, date, and coordinates
 */
export function parseGpxData(gpxContent: string): GpxStats {
  const DOMParser = getDOMParser();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxContent, "application/xml");
  
  // Find all track points
  const trackPoints = Array.from(xmlDoc.getElementsByTagName("trkpt"));
  
  if (trackPoints.length === 0) {
    throw new Error("No track points found in GPX file");
  }
  
  // Extract date from GPX metadata or first track point
  let extractedDate: Date | null = null;
  
  // Try to get date from GPX metadata first
  const metadataElements = xmlDoc.getElementsByTagName("metadata");
  if (metadataElements.length > 0) {
    const timeElements = metadataElements[0].getElementsByTagName("time");
    if (timeElements.length > 0 && timeElements[0].textContent) {
      extractedDate = new Date(timeElements[0].textContent);
    }
  }
  
  // If no metadata time, try to get from first track point timestamp
  if (!extractedDate && trackPoints.length > 0) {
    const timeElements = trackPoints[0].getElementsByTagName("time");
    if (timeElements.length > 0 && timeElements[0].textContent) {
      extractedDate = new Date(timeElements[0].textContent);
    }
  }
  
  // If still no date, try track segment metadata
  if (!extractedDate) {
    const trkElements = xmlDoc.getElementsByTagName("trk");
    if (trkElements.length > 0) {
      const timeElements = trkElements[0].getElementsByTagName("time");
      if (timeElements.length > 0 && timeElements[0].textContent) {
        extractedDate = new Date(timeElements[0].textContent);
      }
    }
  }
  
  let totalDistance = 0;
  let totalElevationGain = 0;
  let previousLat: number | null = null;
  let previousLon: number | null = null;
  let previousEle: number | null = null;
  const coordinates: [number, number][] = [];
  const elevationProfile: ElevationPoint[] = [];
  
  trackPoints.forEach((point: any) => {
    const lat = parseFloat(point.getAttribute("lat") || "0");
    const lon = parseFloat(point.getAttribute("lon") || "0");
    
    if (isNaN(lat) || isNaN(lon)) {
      return; // Skip invalid points
    }
    
    coordinates.push([lon, lat]);
    
    // Calculate distance from previous point
    if (previousLat !== null && previousLon !== null) {
      const distance = calculateDistance(previousLat, previousLon, lat, lon);
      totalDistance += distance;
    }
    
    // Calculate elevation gain and build elevation profile
    const eleElements = point.getElementsByTagName("ele");
    let currentElevation = 0;
    let hasElevationData = false;
    if (eleElements.length > 0) {
      const ele = parseFloat(eleElements[0].textContent || "0");
      if (!isNaN(ele) && ele !== 0) {
        hasElevationData = true;
        currentElevation = metersToFeet(ele);
        if (previousEle !== null && ele > previousEle) {
          totalElevationGain += metersToFeet(ele - previousEle);
        }
        previousEle = ele;
      }
    }
    
    // Add point to elevation profile (only if we have elevation data)
    if (hasElevationData || elevationProfile.length === 0) {
      elevationProfile.push({
        distance: totalDistance,
        elevation: currentElevation,
        coordinates: [lon, lat]
      });
    }
    
    previousLat = lat;
    previousLon = lon;
  });
  
  if (coordinates.length === 0) {
    throw new Error("No valid track points found in GPX file");
  }
  
  return {
    distance: Math.round(totalDistance * 100) / 100, // Round to 2 decimal places
    elevationGain: Math.round(totalElevationGain),
    date: extractedDate,
    coordinates,
    elevationProfile
  };
}

/**
 * Extracts track points with timestamps from GPX content for time-based interpolation
 */
export function parseGpxWithTimestamps(gpxContent: string): TrackWithTimestamps {
  const DOMParser = getDOMParser();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxContent, "application/xml");
  
  const trackPoints = Array.from(xmlDoc.getElementsByTagName("trkpt"));
  
  if (trackPoints.length === 0) {
    return { startTime: null, endTime: null, durationSeconds: 0, points: [] };
  }
  
  const points: TimedTrackPoint[] = [];
  let startTimestamp: number | null = null;
  
  trackPoints.forEach((point: any) => {
    const lat = parseFloat(point.getAttribute("lat") || "0");
    const lon = parseFloat(point.getAttribute("lon") || "0");
    
    if (isNaN(lat) || isNaN(lon)) return;
    
    // Get timestamp from track point
    const timeElements = point.getElementsByTagName("time");
    let timestamp: number | null = null;
    
    if (timeElements.length > 0 && timeElements[0].textContent) {
      timestamp = new Date(timeElements[0].textContent).getTime();
    }
    
    // Get elevation if available
    let elevation: number | undefined;
    const eleElements = point.getElementsByTagName("ele");
    if (eleElements.length > 0) {
      const ele = parseFloat(eleElements[0].textContent || "0");
      if (!isNaN(ele)) {
        elevation = ele;
      }
    }
    
    if (timestamp !== null) {
      if (startTimestamp === null) {
        startTimestamp = timestamp;
      }
      
      points.push({
        timestamp,
        offsetSeconds: (timestamp - startTimestamp) / 1000,
        latitude: lat,
        longitude: lon,
        elevation
      });
    }
  });
  
  // Sort by timestamp
  points.sort((a, b) => a.timestamp - b.timestamp);
  
  const startTime = points.length > 0 ? new Date(points[0].timestamp) : null;
  const endTime = points.length > 0 ? new Date(points[points.length - 1].timestamp) : null;
  const durationSeconds = points.length > 0 
    ? (points[points.length - 1].timestamp - points[0].timestamp) / 1000 
    : 0;
  
  return { startTime, endTime, durationSeconds, points };
}

/**
 * Interpolates coordinates at a given offset (in seconds) from track start
 */
export function interpolateCoordinatesAtOffset(
  track: TrackWithTimestamps, 
  offsetSeconds: number
): { latitude: number; longitude: number } | null {
  if (track.points.length === 0) {
    return null;
  }
  
  // Clamp offset to valid range
  const clampedOffset = Math.max(0, Math.min(offsetSeconds, track.durationSeconds));
  
  // Find surrounding points
  let beforePoint: TimedTrackPoint | null = null;
  let afterPoint: TimedTrackPoint | null = null;
  
  for (let i = 0; i < track.points.length; i++) {
    const point = track.points[i];
    
    if (point.offsetSeconds <= clampedOffset) {
      beforePoint = point;
    }
    
    if (point.offsetSeconds >= clampedOffset && afterPoint === null) {
      afterPoint = point;
      break;
    }
  }
  
  // Handle edge cases
  if (!beforePoint && afterPoint) {
    return { latitude: afterPoint.latitude, longitude: afterPoint.longitude };
  }
  
  if (beforePoint && !afterPoint) {
    return { latitude: beforePoint.latitude, longitude: beforePoint.longitude };
  }
  
  if (!beforePoint || !afterPoint) {
    return null;
  }
  
  // If same point, return it directly
  if (beforePoint === afterPoint || beforePoint.offsetSeconds === afterPoint.offsetSeconds) {
    return { latitude: beforePoint.latitude, longitude: beforePoint.longitude };
  }
  
  // Linear interpolation between surrounding points
  const fraction = (clampedOffset - beforePoint.offsetSeconds) / 
    (afterPoint.offsetSeconds - beforePoint.offsetSeconds);
  
  const latitude = beforePoint.latitude + fraction * (afterPoint.latitude - beforePoint.latitude);
  const longitude = beforePoint.longitude + fraction * (afterPoint.longitude - beforePoint.longitude);
  
  return { latitude, longitude };
}

/**
 * Resolves start and end coordinates for a video clip based on its timeline position
 * Supports both raw GPX strings and parsed JSON with coordinates array
 */
export function resolveClipCoordinates(
  gpxData: any, 
  clipStartTime: number, 
  clipEndTime: number,
  totalDuration?: number // Total project duration in seconds
): { 
  startLatitude: number | null; 
  startLongitude: number | null; 
  endLatitude: number | null; 
  endLongitude: number | null;
} {
  // If gpxData contains raw GPX string, parse it and use timestamp-based interpolation
  if (typeof gpxData === 'string') {
    const track = parseGpxWithTimestamps(gpxData);
    const startCoords = interpolateCoordinatesAtOffset(track, clipStartTime);
    const endCoords = interpolateCoordinatesAtOffset(track, clipEndTime);
    
    return {
      startLatitude: startCoords?.latitude ?? null,
      startLongitude: startCoords?.longitude ?? null,
      endLatitude: endCoords?.latitude ?? null,
      endLongitude: endCoords?.longitude ?? null
    };
  }
  
  if (gpxData && typeof gpxData.rawGpx === 'string') {
    const track = parseGpxWithTimestamps(gpxData.rawGpx);
    const startCoords = interpolateCoordinatesAtOffset(track, clipStartTime);
    const endCoords = interpolateCoordinatesAtOffset(track, clipEndTime);
    
    return {
      startLatitude: startCoords?.latitude ?? null,
      startLongitude: startCoords?.longitude ?? null,
      endLatitude: endCoords?.latitude ?? null,
      endLongitude: endCoords?.longitude ?? null
    };
  }
  
  // Handle parsed JSON format with coordinates array (distance-based interpolation)
  if (gpxData && Array.isArray(gpxData.coordinates) && gpxData.coordinates.length > 0) {
    const coordinates: [number, number][] = gpxData.coordinates;
    const numPoints = coordinates.length;
    
    // If no duration provided, we can't do time-based interpolation
    // Use simple index-based interpolation assuming linear time progression
    if (!totalDuration || totalDuration <= 0) {
      // Without duration, use the first and last points as fallback
      const firstPoint = coordinates[0];
      const lastPoint = coordinates[numPoints - 1];
      
      return {
        startLatitude: firstPoint[1],
        startLongitude: firstPoint[0],
        endLatitude: lastPoint[1],
        endLongitude: lastPoint[0]
      };
    }
    
    // Time-based interpolation: map clip times to positions along the track
    const startFraction = Math.max(0, Math.min(1, clipStartTime / totalDuration));
    const endFraction = Math.max(0, Math.min(1, clipEndTime / totalDuration));
    
    // Find the interpolated position for start time
    const startIndex = startFraction * (numPoints - 1);
    const startIndexLow = Math.floor(startIndex);
    const startIndexHigh = Math.min(startIndexLow + 1, numPoints - 1);
    const startIndexFraction = startIndex - startIndexLow;
    
    const startLat = coordinates[startIndexLow][1] + 
      startIndexFraction * (coordinates[startIndexHigh][1] - coordinates[startIndexLow][1]);
    const startLon = coordinates[startIndexLow][0] + 
      startIndexFraction * (coordinates[startIndexHigh][0] - coordinates[startIndexLow][0]);
    
    // Find the interpolated position for end time
    const endIndex = endFraction * (numPoints - 1);
    const endIndexLow = Math.floor(endIndex);
    const endIndexHigh = Math.min(endIndexLow + 1, numPoints - 1);
    const endIndexFraction = endIndex - endIndexLow;
    
    const endLat = coordinates[endIndexLow][1] + 
      endIndexFraction * (coordinates[endIndexHigh][1] - coordinates[endIndexLow][1]);
    const endLon = coordinates[endIndexLow][0] + 
      endIndexFraction * (coordinates[endIndexHigh][0] - coordinates[endIndexLow][0]);
    
    return {
      startLatitude: startLat,
      startLongitude: startLon,
      endLatitude: endLat,
      endLongitude: endLon
    };
  }
  
  return { 
    startLatitude: null, 
    startLongitude: null, 
    endLatitude: null, 
    endLongitude: null 
  };
}