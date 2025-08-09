import { DOMParser } from "xmldom";

export interface GpxStats {
  distance: number; // in miles
  elevationGain: number; // in feet
  date: Date | null; // extracted from GPX metadata or track points
  coordinates: [number, number][];
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
    
    // Calculate elevation gain
    const eleElements = point.getElementsByTagName("ele");
    if (eleElements.length > 0) {
      const ele = parseFloat(eleElements[0].textContent || "0");
      if (!isNaN(ele) && previousEle !== null && ele > previousEle) {
        totalElevationGain += metersToFeet(ele - previousEle);
      }
      previousEle = ele;
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
    coordinates
  };
}