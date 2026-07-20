# Big Miles — Product Requirements Document

**Version:** 1.0  
**Date:** 2026-06-06  
**Status:** Draft

---

## 1. Product Overview

Big Miles is a personal outdoor adventure journaling tool for creators who document multi-day expeditions, trail runs, backcountry ski days, fishing trips, and other outdoor pursuits. It lets a creator capture GPX tracks, photos, and video footage from each day of a trip, combine them into a rich multimedia story, and share that story with a small invited audience of sponsors and friends.

The emphasis is on **quality of storytelling over quantity of users**. This is not a social platform — there is no feed, no follower count, no algorithmic discovery. It is a private studio for one creator (or a small team) with a curated audience.

---

## 2. Users

| Role | Description |
|---|---|
| **Creator** | The owner of the app. Uploads content, builds field notes and trips, manages access. One primary creator; possibly a small team of 2–3. |
| **Viewer** | A sponsor, friend, or invited follower. Can view published trips and field notes via a shared link. Does not need an account to view public content. |

---

## 3. Goals

- Give the creator a fast, low-friction way to document an adventure while still in the field (mobile) or shortly after returning (web)
- Produce shareable trip pages that are immersive and visually impressive enough to satisfy a sponsor audience
- Handle large media files (long-form video, multi-day GPX tracks) gracefully without technical friction
- Stay private by default — nothing is public until the creator explicitly shares it

### Non-goals (v1)
- Public discovery, search, or explore feed
- Multi-creator accounts or team collaboration
- Monetization or paywalls
- Comments or reactions from viewers
- Real-time activity tracking or live location sharing

---

## 4. User Stories

### Creator — Capturing a Trip

**C1 — Multi-day trip project**
As a creator, I can group multiple field notes into a named trip or expedition so that a three-day backpacking route is presented as one coherent story rather than three disconnected entries.

- A trip has a title, cover photo, description, and date range
- A trip contains an ordered list of field notes (one per day, or per segment)
- The trip overview page shows a combined map with all days' GPX tracks stitched together, total distance and elevation across all days, and a thumbnail gallery from all attached photos

**C2 — GPX and video storytelling**
As a creator, I can upload one or more GPX files and one or more video files to a field note so that viewers can watch footage and see exactly where on the route it was recorded.

- Uploading a GPX file draws the track on a map immediately
- Uploading a video file auto-syncs it to the GPX track using the video's creation timestamp
- As the video plays, a dot moves along the map in real time showing the current location
- Hovering over a segment of the map shows a video thumbnail for that moment; clicking seeks the video to that position
- Hovering over the video timeline shows a location pin on the map for that moment
- If timestamps are slightly off (camera clock drift), the creator can drag an offset slider to correct the alignment

**C3 — Photo capture with GPS**
As a creator, I can upload photos to a field note and have their GPS coordinates automatically extracted from EXIF data so that they appear as pins on the map without manual placement.

- Photos with GPS EXIF appear as pins on the field note map
- Clicking a pin opens a lightbox showing the photo, camera settings, and coordinates
- Photos without GPS can be dragged onto the map to set a location manually (v2)

**C4 — Multiple trip types**
As a creator, I can assign multiple activity categories to a field note (e.g. Hiking + Fishing) so that a day that involved both shows up correctly when I filter my notes.

**C5 — Strava import**
As a creator, I can connect my Strava account and import activities directly into my GPX inbox so that I don't have to manually export and re-upload files I've already recorded.

---

### Viewer — Experiencing a Trip

**V1 — Immersive trip viewing**
As a viewer, I can open a shared trip link and experience the full story — map, video, photos, stats — without needing to create an account.

- The trip page loads fast on mobile and desktop
- The map is interactive: pan, zoom, click segments to seek video
- Photos are presented in a gallery; clicking opens a full-screen lightbox with EXIF details
- The video player is prominent and easy to use; it stays visible while scrolling the page

**V2 — Day-by-day navigation**
As a viewer, I can navigate between individual days of a multi-day trip so that I can focus on a specific segment without losing context of the whole route.

- A sidebar or tab strip shows each day/field note with its thumbnail and date
- Selecting a day updates the map and media to that day's content
- A "full trip" view shows all days combined

**V3 — Stats at a glance**
As a viewer, I can see the key stats for a trip (total distance, total elevation gain, days, activity type) at the top of the trip page so that I understand the scale of the adventure immediately.

---

### Creator — Managing Content

**M1 — Dashboard and search**
As a creator, I can see all my field notes in a dashboard with search and filter by trip type, date range, or keyword so that I can find and manage past entries quickly.

**M2 — Sharing and access**
As a creator, I can publish a trip via a shareable public link and revoke that link at any time so that I control who sees my content.

- Unpublished trips are visible only to the creator
- Published trips are accessible to anyone with the link (no login required for viewers)
- The creator can unpublish a trip to revoke all viewer access

**M3 — Creator stats**
As a creator, I can see aggregate stats across all my field notes (total miles, elevation, trips by type, most active periods) so that I can reflect on my seasons and share meaningful numbers with sponsors.

---

## 5. Feature Priority

### Must-have (v1 — ship this)
| # | Feature | Tied to |
|---|---|---|
| 1 | Field note CRUD with GPX + photo upload | C3, C4 |
| 2 | Multi-day trip grouping with combined map | C1 |
| 3 | Video-GPX sync with live map playhead | C2 |
| 4 | Shareable public trip link | V1, M2 |
| 5 | Viewer trip page (map + video + photos + stats) | V1, V2, V3 |
| 6 | Strava import | C5 |

### Should-have (v1.5)
| # | Feature | Tied to |
|---|---|---|
| 8 | Creator stats dashboard | M3 |
| 9 | Multi-video clips on one field note (morning + afternoon sessions) | C2 |
| 10 | Map thumbnail on hover (video frame at that location) | C2 |
| 11 | Manual GPS placement for photos without EXIF | C3 |

### Nice-to-have (v2)
| # | Feature |
|---|---|
| 12 | Viewer comments / reactions |
| 13 | Insta360 embedded GPS extraction (skip separate GPX) |
| 14 | Year-in-review export (PDF or shareable page) |
| 15 | Route recommendation ("follow this route" download) |
| 16 | Offline iOS support for field capture without signal |

---

## 6. Key UX Principles

**Speed of capture over polish at input time.** A creator returning from a 12-hour day should be able to log a field note in under 2 minutes. The system should auto-populate as much as possible from GPX and photo EXIF — title suggestions from date/location, stats auto-calculated, GPS sync automatic.

**Viewer experience is the product.** The creator uses the tool; the viewer judges it. The shared trip page is effectively a sponsor deliverable. It should feel like a magazine feature, not a database dump.

**Large files are expected.** Insta360 360° footage, full-day GPX tracks, hundreds of RAW-converted JPEGs — these are normal inputs. The system must handle them without the creator having to think about size limits or formats.

**Private by default.** Nothing leaves the creator's account until they explicitly share it. No accidental public exposure.

---

## 7. Open Questions

| Question | Impact | Decision needed by |
|---|---|---|
| Does the viewer trip page need a custom domain (e.g. trips.bigmiles.app)? | Medium — affects branding of sponsor links | Before V1 ship |
| Is there a cap on how many viewers can access a shared link simultaneously? | Low — personal tool, probably never more than 50 concurrent | Can defer |
