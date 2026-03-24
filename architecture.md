# Field Notes GPX Showcase — Architecture Reference

This document is a technical reference for AI agents (Gemini, Claude Code, etc.) working on this codebase. It covers the full system: data models, API routes, upload pipeline, GPX parsing, map plotting, photo-to-timestamp mapping, and TrailCam video processing.

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + Express (TypeScript, ES modules) |
| Frontend | React 18, Vite, Wouter routing, TanStack Query |
| UI | Radix UI + Tailwind CSS + Carbon Design System (`@carbon/react`) |
| Database | PostgreSQL via Drizzle ORM (`drizzle-orm/pg-core`) |
| Object Storage | Google Cloud Storage via Replit sidecar (`http://127.0.0.1:1106`) |
| Maps | Mapbox GL JS |
| EXIF Parsing | `exifr` (server-side only) |
| Video Processing | FFmpeg (spawned as child process) |
| Schema Validation | Zod + `drizzle-zod` |

---

## 2. Project Structure

```
shared/
  schema.ts          — Drizzle table definitions, Zod insert schemas, TypeScript types
  gpx-utils.ts       — GPX parsing, distance/elevation calculation, timestamp interpolation

server/
  index.ts           — Express app entry point
  routes.ts          — All API route handlers
  storage.ts         — IStorage interface + PostgreSQL implementation
  objectStorage.ts   — ObjectStorageService wrapping GCS
  exif-extractor.ts  — EXIF data extraction from image buffers and URLs
  videoProcessor.ts  — FFmpeg-based video transcoding and thumbnail generation

client/src/
  App.tsx            — Route definitions (Wouter)
  pages/             — Page components
  components/
    carbon-photo-uploader.tsx  — Full photo upload UI + compression + retry logic
    gpx-file-uploader.tsx      — GPX file selection and parsing
  lib/
    exif-extractor.ts          — Client-side EXIF type definitions
    queryClient.ts             — TanStack Query setup, apiRequest helper
```

---

## 3. Database Schema (`shared/schema.ts`)

### `field_notes`

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar` (UUID) | Primary key, auto-generated |
| `title` | `text` | Required |
| `description` | `text` | Required |
| `trip_type` | `text` | e.g. hiking, cycling, photography, running |
| `date` | `timestamp` | Required |
| `distance` | `real` | Kilometers |
| `elevation_gain` | `real` | Meters |
| `gpx_data` | `jsonb` | Parsed GPX track stored as JSON (coordinates, elevationProfile, etc.) |
| `created_at` | `timestamp` | Auto |

### `photos`

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar` (UUID) | Primary key |
| `field_note_id` | `varchar` | FK → `field_notes.id` |
| `filename` | `text` | Original filename |
| `url` | `text` | Normalized path: `/objects/<uuid>` |
| `alt_text` | `text` | Optional |
| `latitude` | `real` | From EXIF GPS (decimal degrees, 8 decimal places) |
| `longitude` | `real` | From EXIF GPS |
| `elevation` | `real` | Meters (from `GPSAltitude`) |
| `timestamp` | `timestamp` | From `DateTimeOriginal` / `DateTime` / `CreateDate` |
| `camera` | `text` | `Make Model` string |
| `lens` | `text` | From `LensModel` or `LensSpecification` |
| `aperture` | `text` | e.g. `f/2.8` |
| `shutter_speed` | `text` | e.g. `1/250s` |
| `iso` | `integer` | |
| `focal_length` | `text` | e.g. `24mm` |
| `file_size` | `text` | e.g. `2048 KB` |
| `created_at` | `timestamp` | Auto |

Index: `photos_field_note_id_idx` on `field_note_id`.

### `trailcam_projects`

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar` (UUID) | Primary key |
| `title` | `text` | Required |
| `description` | `text` | Optional |
| `gpx_data` | `jsonb` | GPS route data (required) |
| `duration` | `real` | Total project duration in seconds |
| `start_time` | `timestamp` | Project start |
| `end_time` | `timestamp` | Project end |
| `created_at` | `timestamp` | Auto |

### `video_clips`

| Column | Type | Notes |
|---|---|---|
| `id` | `varchar` (UUID) | Primary key |
| `project_id` | `varchar` | FK → `trailcam_projects.id` |
| `title` | `text` | Required |
| `filename` | `text` | Original filename |
| `url` | `text` | Normalized path to original high-res video |
| `transcoded_url` | `text` | 1080p transcoded version (nullable until processed) |
| `thumbnail_url` | `text` | First-frame JPEG thumbnail (nullable until processed) |
| `processing_status` | `text` | `pending` → `processing` → `ready` / `error` |
| `processing_error` | `text` | Error message if status is `error` |
| `start_time` | `real` | Offset from project start in seconds |
| `end_time` | `real` | Offset from project start in seconds |
| `duration` | `real` | Clip duration in seconds |
| `start_latitude` | `real` | GPS lat at clip start (auto-calculated from GPX) |
| `start_longitude` | `real` | GPS lon at clip start |
| `end_latitude` | `real` | GPS lat at clip end |
| `end_longitude` | `real` | GPS lon at clip end |
| `color` | `text` | Timeline color code (default `#3b82f6`) |
| `file_size` | `text` | |
| `video_format` | `text` | e.g. MP4, WebM |
| `created_at` | `timestamp` | Auto |

Indexes: `video_clips_project_id_idx`, `video_clips_start_time_idx`.

---

## 4. Object Storage Architecture (`server/objectStorage.ts`)

Replit provides Google Cloud Storage access through a local sidecar process at `http://127.0.0.1:1106`. The `@google-cloud/storage` SDK is configured to authenticate against this sidecar using an `external_account` credential that fetches tokens from `http://127.0.0.1:1106/credential`.

Signed upload/download URLs are obtained by POSTing to `http://127.0.0.1:1106/object-storage/signed-object-url`.

### Path Conventions

All stored objects have three equivalent representations:

| Format | Example |
|---|---|
| Normalized app path | `/objects/uploads/<uuid>` |
| Raw bucket path | `/<bucket-name>/.private/uploads/<uuid>` |
| Full GCS URL | `https://storage.googleapis.com/<bucket>/.private/uploads/<uuid>?...` |

The `normalizeObjectEntityPath()` method converts full GCS URLs to normalized `/objects/...` paths. The DB always stores normalized paths.

### Key Methods

- `getObjectEntityUploadURL()` — generates a signed PUT URL for a new UUID-named object in `.private/uploads/`
- `verifyObjectExists(path)` — checks GCS for object existence; handles all three path formats
- `getObjectEntityFile(objectPath)` — resolves `/objects/...` path to a `File` instance
- `getFileFromRawPath(rawPath)` — resolves `/objects/...` or raw bucket paths to a `File` instance
- `downloadObject(file, res)` — streams a GCS file to an Express response with cache headers
- `downloadObjectToStream(file, writeStream)` — streams GCS file to a Node writable (for video processing)
- `generateUploadUrl(filename)` — signed PUT URL for processed video output (stored in `.private/processed/`)

### Environment Variables Required

- `PRIVATE_OBJECT_DIR` — path prefix for user uploads (e.g. `/<bucket-name>/.private`)
- `PUBLIC_OBJECT_SEARCH_PATHS` — comma-separated paths for public asset search

---

## 5. Photo Upload Pipeline

The upload is a multi-step process split across client and server. No photo data passes through the server during the actual upload — the file goes directly from the browser to GCS.

### Step-by-Step Flow

```
Client                              Server                          GCS
------                              ------                          ---
1. User selects image(s)
2. Parallel EXIF extraction
   POST /api/photos/extract-exif
   (batch of max 3 at a time)       Extract EXIF from buffer →
                                    return {camera, GPS, timestamp, ...}
3. compressImage()
   - Skip if < 500KB
   - Canvas resize to max 2048px
   - JPEG re-encode at 85% quality
   - Only use if smaller than original

4. POST /api/photos/upload          Generate signed PUT URL
   ←                                (UUID-named, TTL 15 min)

5. PUT <signed-url> with file body                                  Store object
   - Timeout: max(30s, 1ms/byte)
   - Retry: 3 attempts, exponential backoff (1s, 2s, 4s)

6. POST /api/photos                 verifyObjectExists(url)
   { fieldNoteId, url, filename }   ↓ if missing → 400 error
                                    createPhoto() in DB
                                    ← 201 with photo record
                                    [background] extractExifData(url)
                                      download first 64KB from GCS
                                      parse with exifr
                                      updatePhoto() with EXIF fields
```

### Client Upload Logic (`carbon-photo-uploader.tsx`)

- `compressImage(file, maxWidth=2048, quality=0.85)` — canvas-based compression; skips files < 500KB; only uses compressed version if smaller than original
- Parallel uploads via `Promise.all()` across all selected files
- Dynamic timeout: `Math.max(30000, file.size / 1024)` ms (at least 30s, grows with file size)
- Retry loop: up to 3 attempts with 1s/2s/4s delays

### Server Upload Verification (`server/routes.ts` → `POST /api/photos`)

Before creating the DB record, the server calls `objectStorageService.verifyObjectExists(url)`. If the object is not found in GCS, it returns HTTP 400 with `"Upload verification failed"`. This prevents orphaned database records from partial or failed uploads.

### Background EXIF Processing

After the 201 response is sent, the server uses `setImmediate()` to run EXIF extraction asynchronously:

```typescript
setImmediate(async () => {
  const exifData = await Promise.race([
    extractExifData(photo.url),
    new Promise((_, reject) => setTimeout(reject, 30000)) // 30s timeout
  ]);
  if (Object.keys(exifData).length > 0) {
    await storage.updatePhoto(photo.id, { ...exifData });
  }
});
```

This means EXIF data (GPS, camera info, timestamp) may not be available immediately on the 201 response but will be populated shortly after.

---

## 6. EXIF Data Extraction (`server/exif-extractor.ts`)

Uses the `exifr` library with these settings enabled: `gps: true, exif: true`, with key/value translation enabled for proper coordinate interpretation.

### GPS Coordinate Conversion

iPhone and most cameras store GPS in DMS (Degrees, Minutes, Seconds) format in three separate EXIF arrays. The extractor manually converts:

```typescript
latitude = latDeg + (latMin / 60) + (latSec / 3600)  // then negate if 'S'
longitude = lngDeg + (lngMin / 60) + (lngSec / 3600) // then negate if 'W'
```

Result is stored to 8 decimal places. Falls back to pre-converted `exifData.latitude`/`longitude` if DMS arrays are absent.

### Timestamp Priority

Checked in this order: `DateTimeOriginal` → `DateTime` → `CreateDate` → `ModifyDate`.

### Optimization for Background Processing

When extracting from a stored URL (`extractExifData(url)`), only the first 64KB of the file is downloaded. EXIF data in JPEG files is always at the start of the file, so this is sufficient.

---

## 7. GPX Track Parsing and Plotting (`shared/gpx-utils.ts`)

This module is shared between server and client (imported as `@shared/gpx-utils`).

### `parseGpxData(gpxContent: string): GpxStats`

Parses a raw GPX XML string and returns:

- `distance` — total track distance in **miles** (Haversine formula, 2 decimal places)
- `elevationGain` — cumulative elevation gain in **feet** (meters × 3.28084, positive gain only)
- `date` — extracted from GPX `<metadata><time>`, or first `<trkpt><time>`, or `<trk><time>`
- `coordinates` — array of `[longitude, latitude]` tuples (Mapbox format: lon first)
- `elevationProfile` — array of `{ distance, elevation, coordinates }` for charting

### `parseGpxWithTimestamps(gpxContent: string): TrackWithTimestamps`

Extended parser that extracts per-point timestamps for time-based interpolation. Returns:

- `startTime`, `endTime` — Date objects from first/last track point
- `durationSeconds` — total track duration
- `points` — array of `TimedTrackPoint`: `{ timestamp, offsetSeconds, latitude, longitude, elevation? }`

Points are sorted by timestamp. `offsetSeconds` is relative to the first point (track start = 0).

### `interpolateCoordinatesAtOffset(track, offsetSeconds)`

Linear interpolation between surrounding track points. Clamps `offsetSeconds` to `[0, durationSeconds]`. Returns `{ latitude, longitude }` or `null` if track is empty.

---

## 8. Photo-to-Timestamp Mapping

Photos store `timestamp` (from EXIF `DateTimeOriginal`) and `latitude`/`longitude` (from EXIF GPS). These are used independently — photos are not mapped onto GPX tracks by interpolation; their positions come directly from EXIF GPS data.

The GPX track is shown on the map as a route line, while photos are shown as markers at their EXIF GPS coordinates. The `timestamp` field enables chronological sorting and potential future time-correlation with the GPX track.

---

## 9. TrailCam Studio: Video-to-GPS Coordinate Mapping

### How Clip Coordinates Are Calculated

When a video clip is created (`POST /api/video-clips`), the server fetches the parent project's `gpxData` and calls `resolveClipCoordinates()`:

```typescript
const coords = resolveClipCoordinates(
  project.gpxData,
  validatedData.startTime,  // seconds from project start
  validatedData.endTime,    // seconds from project start
  project.duration          // total project duration in seconds
);
```

`resolveClipCoordinates()` handles three cases:

1. **Raw GPX string in `gpxData`** — uses `parseGpxWithTimestamps()` + `interpolateCoordinatesAtOffset()` for true timestamp-based interpolation
2. **Object with `gpxData.rawGpx` string** — same as above
3. **Parsed JSON with `gpxData.coordinates` array** — uses fractional index interpolation:
   - `startFraction = clipStartTime / totalDuration`
   - Index into coordinates array, linearly interpolate between adjacent points

The calculated `startLatitude`, `startLongitude`, `endLatitude`, `endLongitude` are stored on the `video_clips` row. They can be recalculated via `POST /api/video-clips/:id/recalculate-coordinates`.

### Video Processing Pipeline (`server/videoProcessor.ts`)

After clip creation, `startVideoProcessing(clipId)` is called via `setImmediate()` for non-blocking background processing:

```
1. Set processingStatus = 'processing'
2. Download original video from GCS → /tmp/video-processing/<clipId>/input.mp4
3. FFmpeg: extract thumbnail at 1s mark (fallback: 0s) → thumbnail.jpg (640px wide)
4. FFmpeg: transcode to 1080p H.264 → transcoded.mp4
   - scale=-2:1080, libx264, preset=fast, crf=23, aac 128k, +faststart
5. Upload thumbnail.jpg and transcoded.mp4 to GCS (.private/processed/)
6. Update clip: thumbnailUrl, transcodedUrl, processingStatus = 'ready'
7. On error: processingStatus = 'error', processingError = message
8. Cleanup: rm -rf /tmp/video-processing/<clipId>/
```

### Video Streaming

`GET /api/video-clips/:id/stream` serves the transcoded URL (falling back to original) with HTTP range request support for seek-capable playback. Uses `206 Partial Content` when a `Range` header is present.

---

## 10. API Endpoint Reference

### Field Notes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/field-notes` | List all, with `?search=`, `?tripType=`, `?sortOrder=` |
| `GET` | `/api/field-notes/:id` | Get by ID (includes `photos` array) |
| `GET` | `/api/field-notes/:id/photos` | Get photos for a field note |
| `POST` | `/api/field-notes` | Create field note (body validated with `insertFieldNoteSchema`) |
| `PUT` | `/api/field-notes/:id` | Update field note |
| `DELETE` | `/api/field-notes/:id` | Delete field note (204) |

### Photos

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/photos/:id` | Get photo by ID |
| `POST` | `/api/photos/upload` | Get signed PUT URL for direct GCS upload |
| `POST` | `/api/photos` | Create photo record (verifies GCS object first; triggers background EXIF) |
| `POST` | `/api/photos/extract-exif` | Extract EXIF from uploaded file buffer (multipart/form-data, `photo` field) |
| `POST` | `/api/photos/extract-exif-from-url` | Extract EXIF from existing stored URL |
| `POST` | `/api/photos/update-all-exif` | Batch-update EXIF for all photos missing camera data |

### Object Serving

| Method | Path | Description |
|---|---|---|
| `GET` | `/objects/:objectPath(*)` | Serve stored private object (photo/video) |
| `GET` | `/public-objects/:filePath(*)` | Serve public asset from `PUBLIC_OBJECT_SEARCH_PATHS` |
| `POST` | `/api/objects/upload` | Generic signed PUT URL (used for video uploads) |

### TrailCam Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/trailcam-projects` | List with `?search=`, `?sortOrder=` |
| `GET` | `/api/trailcam-projects/:id` | Get by ID |
| `POST` | `/api/trailcam-projects` | Create project |
| `PUT` | `/api/trailcam-projects/:id` | Update project |
| `DELETE` | `/api/trailcam-projects/:id` | Delete project (204) |

### Video Clips

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/video-clips?projectId=` | List clips for a project |
| `GET` | `/api/video-clips/:id` | Get by ID |
| `POST` | `/api/video-clips` | Create clip (auto-calculates GPS coords, starts processing) |
| `PUT` | `/api/video-clips/:id` | Update clip |
| `DELETE` | `/api/video-clips/:id` | Delete clip (204) |
| `GET` | `/api/video-clips/:id/stream` | Stream video (range requests supported) |
| `GET` | `/api/video-clips/:id/thumbnail` | Serve thumbnail JPEG |
| `POST` | `/api/video-clips/:id/reprocess` | Retry failed video processing |
| `POST` | `/api/video-clips/:id/recalculate-coordinates` | Recalculate GPS from GPX |

---

## 11. Chunked Video Upload System

Large videos (up to 1.5GB) use a chunked upload system in `server/routes.ts`:

- Chunk size: 10MB
- Max chunks: 200
- Upload timeout: 30 minutes per session
- Upload token: HMAC-SHA256 signed JWT (1 hour TTL, IP-bound)
- Rate limiting: 100 requests/min/IP
- Concurrency limit: 3 simultaneous uploads per IP
- Chunk files stored in `/tmp/video-chunks/<uploadKey>/`
- Stale sessions cleaned up every 5 minutes

---

## 12. Key Design Decisions for AI Agents

1. **Normalized URL storage** — the DB always stores `/objects/<uuid>` paths, never full GCS URLs or signed URLs. Use `objectStorageService.normalizeObjectEntityPath()` before storing any URL.

2. **Upload verification before DB write** — always call `verifyObjectExists()` before `storage.createPhoto()`. Skipping this causes orphaned records when uploads partially fail.

3. **EXIF is always asynchronous** — photo records exist in the DB before EXIF is populated. Code that needs EXIF (GPS, camera, timestamp) must handle the case where those fields are `null`.

4. **GPX data stored as parsed JSON** — `field_notes.gpx_data` is stored as parsed JSON (not raw XML), containing `{ distance, elevationGain, date, coordinates, elevationProfile }`. For TrailCam projects, `trailcam_projects.gpx_data` may contain `{ rawGpx: string, ...parsed }` to preserve the raw XML for timestamp-based interpolation.

5. **Coordinates are `[longitude, latitude]`** — following GeoJSON/Mapbox conventions (lon first), not the more intuitive lat/lon order. The elevation profile uses the same convention.

6. **Distance in miles, elevation in feet** — the `parseGpxData()` function outputs miles and feet. The DB schema stores `distance` in kilometers and `elevation_gain` in meters (as noted in the schema comments), so if using `parseGpxData()` output to populate field notes, convert appropriately.

7. **Video processing is fire-and-forget** — `startVideoProcessing()` uses `setImmediate()`. The API response returns before transcoding completes. Poll `processingStatus` on the clip to know when it is `ready`.
