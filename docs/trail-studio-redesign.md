# Trail Studio Redesign — Technical Design Document

**Status:** Draft  
**Date:** 2026-06-05  
**Scope:** Full redesign of TrailCam Studio into a first-class Trail Studio feature with automatic video-GPX sync, live map tracking during playback, and field note integration.

---

## 1. The Problem with the Current System

The existing TrailCam Studio has the right skeleton but the wrong mental model:

| Current | Desired |
|---|---|
| User manually enters clip start/end times (seconds) | Auto-detect from video and GPX timestamps |
| "Project" abstraction, separate from field notes | Attached directly to a field note |
| Map shows static start/end dots per clip | Map cursor moves in real time as video plays |
| Click on map does nothing | Click on map segment seeks video to that moment |
| Video streams through the server (bottleneck) | Video streams directly from GCS via signed URL |
| One quality level (1080p transcode) | Original file streamed; lightweight proxy thumbnail only |
| Processing via `setImmediate` (unreliable in prod) | Decoupled background job with status polling |

The core architectural insight that makes everything else fall into place:

> **Both the Insta360 video and the GPX file carry UTC wall-clock timestamps. The sync problem is just subtraction: `video_seek_offset = gps_point_time − video_start_time`.**

No manual clip timing. No guessing. If the GPX has `<time>` elements (which Garmin, Wahoo, Strava, and Insta360 internal GPS all produce), alignment is automatic.

---

## 2. Insta360 File Format Notes

### What the camera produces
- **Newer models (X3, X4, RS 1-inch, Go 3):** `.MP4` + companion `.LRV` (low-res preview) + `.GYRO` metadata sidecar. The MP4 is a standard H.264/H.265 container readable by FFmpeg and browsers.
- **Older models (One X2 and earlier):** `.INSV` (proprietary). Requires the Insta360 desktop app or the `insta360-sdk` to convert to MP4 first. **Out of scope for v1 — tell users to export as MP4.**
- **Internal GPS telemetry:** Many Insta360 models embed GPS in the video in a private MP4 box (`camm`, `gpmd`, or similar). This is accessible via `ffprobe -v quiet -print_format json -show_streams`. If available, we can skip the separate GPX file entirely (see §7 for the optional enhancement path).

### What to ask users to provide
For v1: an MP4 exported from the Insta360 app (360° or flat) + a GPX file from any source (Garmin watch, Strava export, Insta360 app export, etc.).

### Why the video start timestamp matters
Every MP4 file has a creation time embedded in the `moov/mvhd` atom (the `creationTime` field). FFmpeg surfaces this as:
```
ffprobe -v quiet -print_format json -show_format file.mp4
→ format.tags.creation_time = "2024-05-15T10:25:00.000000Z"
```
This is the UTC time the recording started. Combined with the GPX track's `<time>` elements, alignment is fully automatic.

---

## 3. The Synchronization Model

### Terminology
- **`T_video_start`**: UTC timestamp when recording began (from MP4 metadata)
- **`T_gps(point)`**: UTC timestamp on a GPX track point
- **`t_video(point)`**: Playback offset (seconds) to show the GPS point: `T_gps(point) − T_video_start`
- **`T_gps(t)`**: Inverse — given a video playback position `t`, the corresponding GPS timestamp: `T_video_start + t`

### Map → Video (click to seek)
1. User clicks a location on the GPX track line
2. Find the nearest GPX track point (or interpolate) → get `T_gps`
3. Compute `t = T_gps − T_video_start`
4. If `0 ≤ t ≤ video_duration`: call `videoElement.currentTime = t`
5. Else: show "No footage at this location"

### Video → Map (playback sync)
1. On every `timeupdate` event (fires ~4–10x/sec), get `videoElement.currentTime` → `t`
2. Compute `T_gps = T_video_start + t`
3. Call `interpolateCoordinatesAtOffset(track, t + video_offset_seconds)` — this already exists and is O(n) linear scan, fine for a few thousand GPX points
4. Move a marker/dot on the Mapbox map to that coordinate; pan map to keep it in view

### Multi-video projects
When the user attaches more than one video clip (e.g. multiple descent runs on the same GPX track):
- Each clip stores its own `videoStartTime` (UTC ISO string)
- The UI shows all clips on the same timeline bar; clicking any segment loads that clip and seeks correctly
- Clips may overlap in GPS time (e.g. two laps of the same loop) — the UI shows both and lets the user pick

### What if the timestamps don't match?
Users often have clock drift between devices, or they forgot to sync their camera time. The UI exposes a **manual offset slider** (±5 minutes in 1-second increments) that shifts `T_video_start` for the current clip. This offset is saved per-clip in the database.

---

## 4. Data Model Changes

### Keep
- `trailcamProjects` table — rename to just `trailSessions` or keep name; attach `fieldNoteId` FK
- `videoClips` table — mostly keep, significant column changes

### Change on `trailcamProjects`
```sql
ALTER TABLE trailcam_projects
  ADD COLUMN field_note_id varchar REFERENCES field_notes(id) ON DELETE CASCADE,
  ADD COLUMN gpx_raw text,           -- raw GPX string (add this; currently only stores parsed JSON)
  ADD COLUMN gpx_start_time timestamptz,   -- parsed from GPX
  ADD COLUMN gpx_end_time   timestamptz;   -- parsed from GPX
```
Storing the raw GPX string is important — the parsed JSON coordinates are already there but we need the original for re-parsing with `parseGpxWithTimestamps`.

### Change on `videoClips`
```sql
-- Remove (manual timing, now auto-computed)
ALTER TABLE video_clips DROP COLUMN start_time;
ALTER TABLE video_clips DROP COLUMN end_time;

-- Add (automatic timestamp-based sync)
ALTER TABLE video_clips
  ADD COLUMN video_start_time  timestamptz,  -- UTC creation time from MP4 metadata
  ADD COLUMN video_end_time    timestamptz,  -- video_start_time + duration
  ADD COLUMN time_offset_secs  real DEFAULT 0, -- manual user correction (drift)
  ADD COLUMN gpx_coverage_pct  real,         -- what % of the GPX track this clip covers
  -- keep existing GPS coordinate columns (now auto-populated from sync)
  -- keep existing processing columns
  ADD COLUMN original_format   text;         -- 'mp4', 'insv', 'mov', etc.
```

The `startTime`/`endTime` as project-relative offsets disappear. Everything is now wall-clock UTC, so clips from different sessions (or different cameras) can be combined on the same timeline without any manual alignment.

### New: `field_note_trail_sessions` (if you want N:M linking)
A field note can have one trail session. For simplicity in v1, a single `field_note_id` FK on `trailcam_projects` is enough.

---

## 5. Large File Handling — Recommended Architecture

### Current problem
The server streams video through itself:
```
Browser → GET /api/video-clips/:id/stream → Server → GCS → Server → Browser
```
This doubles bandwidth usage and puts memory pressure on the server during simultaneous views.

### Recommended: Signed URL pass-through
```
Browser → GET /api/video-clips/:id/stream-url → Server validates auth → returns signed GCS URL (15 min TTL)
Browser → GET signed_gcs_url (direct, with Range headers) → GCS
```

GCS supports byte-range requests natively, which is what `<video>` elements need for seeking. The server issues a short-lived signed URL and gets out of the way.

```typescript
// server/routes.ts
app.get("/api/video-clips/:id/stream-url", isAuthenticated, async (req, res) => {
  const clip = await storage.getVideoClipById(req.params.id);
  const url = await objectStorageService.getSignedReadUrl(
    clip.transcodedUrl ?? clip.url, 
    15 * 60  // 15 minutes TTL
  );
  res.json({ url, expiresIn: 900 });
});
```

The client refreshes the URL before it expires (just fetches a new one when `currentTime` approaches the end or when paused for a while).

**Impact:** Eliminates server streaming load entirely. Dramatically better for large Insta360 files (often 10–40 GB for a full day's footage).

### Upload: Keep chunked upload, improve it
The existing 10 MB chunk / 1.5 GB cap / resumable upload is solid for the typical use case. Two improvements:

1. **Raise the cap to 10 GB** (increase `MAX_VIDEO_SIZE` and `MAX_CHUNKS`). Insta360 360° footage is large.
2. **Extract video metadata server-side immediately after assembly** (creation time, duration, format) — currently this isn't done. Add FFprobe step after `complete-upload` before the transcoding queue.

### Transcoding: Thumbnail only for v1
The current 1080p re-encode is expensive and provides minimal benefit — the original MP4 is already browser-playable. Proposal:
- **Generate thumbnail only** (1 frame, FFmpeg, already implemented)
- **Skip full re-transcode** unless the file is `.insv` or another non-browser format
- This cuts processing time from ~10 minutes (1080p re-encode of 1 GB) to ~10 seconds (thumbnail)

For Insta360 360° video specifically: the "flat" (rectilinear) export from the Insta360 app is already an H.264 MP4 and needs no re-encode.

---

## 6. API Changes

### New endpoints
```
POST /api/trail-sessions/:id/extract-video-metadata
  — Runs ffprobe on the stored video file; returns {creationTime, duration, format}
  — Called automatically after upload-complete; also callable on-demand

GET  /api/video-clips/:id/stream-url
  — Returns a short-lived signed GCS URL for direct browser streaming
  — Replaces current /stream proxy endpoint

POST /api/video-clips/:id/sync-coordinates
  — Re-runs GPX interpolation using current time_offset_secs value
  — Useful when user adjusts the manual offset slider

GET  /api/trail-sessions/:id/timeline
  — Returns all clips for a session with their GPS coverage spans
  — Used to draw the combined timeline + map overlay
```

### Modified endpoints
```
POST /api/video-clips
  — Remove: startTime, endTime (project-relative seconds)
  — Add: videoStartTime (auto-populated from ffprobe), timeOffsetSecs (default 0)
  — Auto-populates GPS coordinates using wall-clock sync

POST /api/trailcam-projects  (or new /api/trail-sessions)
  — Add: fieldNoteId (optional link)
  — Add: gpxRaw (store raw GPX string, not just parsed JSON)
  — Parse gpxRaw immediately: extract gpxStartTime, gpxEndTime, store on project
```

---

## 7. UI Design

### Trail Studio page layout (redesigned)

```
┌──────────────────────────────────────────────────────────────────┐
│ Trail Studio              [New Session]  [Open Session ▾]        │
├───────────────────────────────┬──────────────────────────────────┤
│                               │                                  │
│     MAPBOX MAP                │     VIDEO PLAYER                 │
│                               │     <video> element              │
│  • GPX track drawn            │     signed GCS URL               │
│  • Moving dot = playhead      │     native browser controls      │
│  • Colored spans = clip       │                                  │
│    coverage on track          │     "No footage at this          │
│  • Click track → seek video   │      location" if gap            │
│                               │                                  │
├───────────────────────────────┴──────────────────────────────────┤
│ TIMELINE (full width, 48px tall)                                 │
│ ░░░░░░░░░░░░░░[clip A ████████████]░░[clip B ████]░░░░░░░░░░░░░ │
│ │              GPX track duration                              │  │
│ ▲ playhead (moves as video plays)                                │
├──────────────────────────────────────────────────────────────────┤
│ SESSION PANEL                                                    │
│ [Upload GPX]  [Upload Video(s)]   Offset: [──●────] +2s         │
│                                                                  │
│ Clips: [card] [card] [card]  + Add Clip                         │
└──────────────────────────────────────────────────────────────────┘
```

### Key interactions

**Upload flow (v1 — simple path):**
1. User creates a new session, gives it a name
2. Drops a `.gpx` file → parsed immediately, track drawn on map, timestamps extracted
3. Drops one or more `.mp4` files → chunked upload starts
4. After upload: server runs ffprobe → extracts `creationTime` → computes sync automatically
5. Each clip appears on the timeline at the correct temporal position relative to the GPX track
6. Map immediately shows which portions of the track have footage (colored line segments)

**Playback:**
- Play/pause on the `<video>` element
- Every `timeupdate` → interpolate GPS position → move dot on map
- If the map is panned manually, it returns to auto-follow after 3 seconds of inactivity

**Map click to seek:**
- User clicks any point on the GPX line
- System finds nearest timestamped point, computes video offset
- If a clip covers that time: load that clip's signed URL, seek to offset, play
- If no clip: show toast "No footage recorded at this location"

**Offset correction:**
- A slider ±300 seconds (±5 min) with 1-second steps
- Realtime preview: as slider moves, the dot on the map repositions relative to the track
- On release: save `timeOffsetSecs` to DB, re-compute GPS columns on the clip

### Timeline component
The timeline is a horizontal bar representing the full GPX track duration. Each clip is drawn as a colored rectangle positioned by wall-clock time:
```
clip_left_pct  = (videoStartTime + offsetSecs - gpxStartTime) / gpxDuration * 100
clip_width_pct = clipDuration / gpxDuration * 100
```
Gaps (no footage) are shown in a muted color. Hover on a clip shows its title and duration.

---

## 8. Field Note Integration

### Concept
A field note is a record of a specific outing. A trail session is the multimedia representation of that same outing. The two should be linked, not separate features.

### Proposed UX flow
1. User creates a field note in the existing admin form
2. New section: "Trail Footage" — shows a "Link Trail Session" button
3. Opens a picker of existing unlinked trail sessions, or "Create New Session"
4. If creating new: mini-wizard right there (upload GPX, upload video) — same components, embedded inline
5. Once linked, the field note detail page shows:
   - The GPX map (already exists)
   - A "Watch Footage" button that opens the trail studio player in a modal or side panel
   - Photo markers on the map (already have GPS coordinates from EXIF)
   - Video segment markers on the map (from trail session)

### Data relationship
```
field_notes
  └─ trailcam_projects (field_note_id FK, nullable)
       └─ video_clips (project_id FK)
```

One field note → at most one trail session (one-to-one for now; could be one-to-many for multi-day trips later).

### Field note detail page changes
- Add a `GET /api/field-notes/:id/trail-session` endpoint that returns the linked session and its clips
- Add a `<TrailFootageSection>` component to the field note detail page
- If no session linked: show "Add Trail Footage" prompt
- If session linked: show the Mapbox map with GPX + clip segments + playback button

---

## 9. Implementation Phases

### Phase 1 — Foundation (do first, blocks everything)
**Goal:** Automatic GPS-video sync works end-to-end for a single clip.

1. **Server:** Add `ffprobe` step after video upload-complete → extract `creationTime` + `duration` → store on clip
2. **Schema:** Add `video_start_time` (timestamptz), `time_offset_secs` (real) to `video_clips`; add `gpx_raw` (text), `gpx_start_time`, `gpx_end_time` to `trailcam_projects`
3. **Server:** New `POST /api/video-clips/:id/sync-coordinates` using wall-clock math instead of project-relative offsets
4. **Server:** New `GET /api/video-clips/:id/stream-url` (signed GCS URL, replaces proxy)
5. **Client:** Update `<video src>` to use signed URL from new endpoint; refresh before expiry
6. **Client:** Add `timeupdate` handler → `interpolateCoordinatesAtOffset` → move map dot
7. **Client:** Add map click → video seek handler

**Deliverable:** Upload a GPX + one Insta360 MP4 → video auto-aligns → playing video moves dot on map → clicking map seeks video.

### Phase 2 — Multi-clip + offset correction
**Goal:** Multiple clips on same session, manual drift correction.

1. **Client:** Timeline bar showing all clips at correct positions with gap visualization
2. **Client:** Offset slider (±5 min) with live map preview
3. **Server:** Recalculate GPS coordinates when offset changes
4. **Client:** Clip cards show which GPX span they cover (percentage)
5. Raise upload cap to 10 GB

**Deliverable:** Multiple Insta360 clips (morning + afternoon) on one GPX track, independently correctable.

### Phase 3 — Field note integration
**Goal:** Trail session linked to field note; playable from field note detail page.

1. **Schema:** Add `field_note_id` FK to `trailcam_projects`
2. **Server:** `GET /api/field-notes/:id/trail-session` + session link/unlink endpoints
3. **Client:** "Trail Footage" section in field note admin form
4. **Client:** `<TrailFootageSection>` component in field note detail page
5. Combined map: GPX track + photo EXIF positions + video segment markers all on one Mapbox map

**Deliverable:** End-to-end experience — create a field note, attach GPX (for stats), attach video(s), view everything unified on the detail page.

### Phase 4 — Optional enhancements (later)
- Extract embedded GPS from Insta360 MP4 (via `camm`/`gpmd` box parsing with ffprobe) → eliminate need for separate GPX file
- Adaptive bitrate: transcode to HLS `.m3u8` + segments for large files (reduces initial load time)
- Timeline thumbnails: extract frame every 10 seconds as sprite sheet for hover preview
- `.INSV` format support via Insta360 SDK

---

## 10. Existing Architecture: What to Keep vs Refactor

### Keep as-is
| Component | Reason |
|---|---|
| Chunked video upload (10 MB chunks, HMAC tokens, resume) | Solid. Just raise the size cap. |
| `parseGpxWithTimestamps` + `interpolateCoordinatesAtOffset` | Correct, already battle-tested. Core of the sync math. |
| Mapbox map component | Works well, already has GPX track drawing. |
| FFmpeg thumbnail generation | Keep. Only remove the 1080p re-encode. |
| GCS object storage via Replit sidecar | Keep. Add `getSignedReadUrl()` method. |

### Refactor
| Component | Issue | Fix |
|---|---|---|
| Server-side video proxy (`/api/video-clips/:id/stream`) | Doubles bandwidth, memory pressure | Replace with signed URL pass-through |
| Project-relative `startTime`/`endTime` (seconds from project start) | Requires manual input, breaks with multiple clips | Replace with wall-clock UTC `videoStartTime` |
| `setImmediate()` for video processing | Unreliable; if server restarts mid-process, job is lost | Add a status-poll pattern: client polls `/api/video-clips/:id` every 3s (already partially done) and server re-triggers on startup for `pending` clips |
| No raw GPX stored on project | Re-parsing JSON coordinates → loses timing info | Store `gpx_raw` (raw string) alongside parsed `gpx_stats` JSON |
| Full 1080p re-encode | Slow (10+ min for 1 GB), unnecessary for browser-compatible MP4 | Skip re-encode; thumbnail only |

### No refactor needed
- Auth (`isAuthenticated` with Bearer token support for mobile) — all new routes just use this
- Field notes CRUD — Phase 3 adds a FK relationship, no other changes
- Drizzle ORM schema migration pattern — continue with the idempotent `DO $$ BEGIN ... END $$` pattern already used in `server/index.ts`

---

## 11. Open Questions / Risks

| Question | Risk Level | Notes |
|---|---|---|
| **Insta360 MP4 creation time accuracy** | Medium | Some cameras set creation time to local time but store in UTC. Test with actual Insta360 hardware before shipping Phase 1. |
| **FFprobe availability in Replit** | Low | FFprobe is bundled with FFmpeg; if `ffmpeg` works today (transcoding is already in code), `ffprobe` is available. |
| **GCS signed URL generation** | Low | The Replit GCS sidecar supports V4 signed URLs. Need to verify the exact API call on the `@google-cloud/storage` SDK version in use. |
| **10 GB upload through Replit** | Medium | Replit itself may have network/storage quotas. Test with a large file before promising this to users. Chunked upload handles it in theory; check if GCS bucket has size limits. |
| **GPX without timestamps** | Low | Some export formats (old Garmin, manual routes) have no `<time>` elements. The existing `resolveClipCoordinates` already handles this by falling back to fractional distance. Just warn the user that auto-sync requires timestamped GPX. |
| **Multiple cameras on one trip** | Low | Phase 2 multi-clip handles this; each clip has its own `videoStartTime`. Just works. |

---

## 12. Key Dependencies to Add

```json
// No new server deps needed — FFprobe comes with FFmpeg (already a dep)
// Client: no new deps needed for Phase 1-3

// Optional for Phase 4 (HLS):
"hls.js": "^1.5.x"  // client-side HLS player

// Optional for Phase 4 (embedded Insta360 GPS):
// Parse 'camm' MP4 box — can be done with a small custom parser, no library needed
```

---

## Summary

The redesign has one core insight — **use wall-clock UTC timestamps to align video and GPS automatically** — and everything else flows from that. The existing chunked upload, GPX parsing, Mapbox map, and GCS storage are all sound and stay. The things that go away are: the manual clip timing UI, the server-as-video-proxy, and the unnecessary full re-encode. The things that get added are: ffprobe extraction of video creation time, a signed-URL pass-through for streaming, a `timeupdate` → map sync loop, and a field note FK relationship.

Phase 1 is the most important — it proves the sync model works with real Insta360 footage — and is achievable without touching field notes or the multi-clip UI. Phases 2 and 3 layer on top cleanly.
