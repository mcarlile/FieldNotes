/**
 * Usage:
 *   npx tsx scripts/seed-field-note.ts \
 *     --title "Lunch Rip to the Prosser Pits" \
 *     --type Motorcycle \
 *     --date 2026-10-21 \
 *     --gpx /path/to/file.gpx
 *
 * --type can be repeated for multiple trip types.
 * --date defaults to today.
 * --gpx is optional; omit to create a note without track data.
 */
import { readFileSync } from "fs";
import pg from "pg";
import { parseGpxData } from "../shared/gpx-utils.js";

const { Pool } = pg;

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function argAll(name: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) {
      results.push(process.argv[++i]);
    }
  }
  return results;
}

const title = arg("title");
if (!title) { console.error("--title is required"); process.exit(1); }

const tripTypes = argAll("type");
if (tripTypes.length === 0) { console.error("--type is required"); process.exit(1); }

const dateStr = arg("date") ?? new Date().toISOString().slice(0, 10);
const gpxPath = arg("gpx");

let gpxData: any = null;
let distance: number | null = null;
let elevationGain: number | null = null;

if (gpxPath) {
  const raw = readFileSync(gpxPath, "utf8");
  const parsed = parseGpxData(raw);
  gpxData = { ...parsed, rawGpx: raw };
  distance = parsed.distance;
  elevationGain = parsed.elevationGain;
  console.log(`GPX parsed: ${distance} miles, ${elevationGain} ft gain, ${parsed.coordinates.length} points`);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(
    `INSERT INTO field_notes (title, description, trip_type, date, gpx_data, distance, elevation_gain, is_published)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING id, title`,
    [title, "", tripTypes, new Date(dateStr), gpxData ? JSON.stringify(gpxData) : null, distance, elevationGain]
  );
  console.log("Created field note:", result.rows[0]);
} finally {
  await pool.end();
}
