# Strava Integration — Revised Architecture Plan
**Big Miles — reviewed against actual codebase, May 2026**

This document reviews Gemini's integration proposal against the real codebase and replaces it with a corrected, implementation-ready plan. Read the "Where Gemini's Plan Diverges" section first — several of its assumptions are based on a fictional version of this stack.

---

## Where Gemini's Plan Diverges from Reality

### 1. The inbox pipeline does not use object storage

Gemini describes the current pipeline as: *"saves the GPX file to object storage (Supabase Storage / Cloudflare R2)"*

This is incorrect. Object storage in this app (Google Cloud Storage via a Replit sidecar at `http://127.0.0.1:1106`) is used exclusively for **photos and videos**. GPX tracks in the inbox are stored as raw text directly in the `raw_gpx TEXT` column of the `gpx_inbox` table. No upload, no URL, no object storage involved.

**Impact on the plan:** When a Strava GPX is fetched (either exported from a Route or reconstructed from Activity streams), it goes straight into `storage.createInboxItem({ rawGpx: string, ... })`. That's the entire ingestion pipeline. Gemini's upload step is eliminated.

### 2. Strava tokens must not go in the `users` table

Gemini proposes adding `strava_athlete_id`, `strava_access_token`, etc. as columns on the `users` table.

The `users` table (`shared/models/auth.ts`) is managed by the Replit Auth (OIDC) integration. Its `upsertUser()` method is called automatically on every login with a specific fixed set of fields. While it uses `onConflictDoUpdate` with named columns (so it won't wipe Strava fields), modifying this table is fragile — any future change to the Replit Auth module could break it.

The existing pattern in this codebase is to use a **separate table for each per-user credential set**, exactly as `webhook_tokens` does. A `strava_connections` table is the right answer. It follows the established pattern, is cleanly deletable on disconnect, and doesn't touch auth infrastructure.

### 3. There is an existing bug in the inbox routes that must be fixed first

The Replit Auth system stores the user object as `{ claims: {...}, access_token, refresh_token, expires_at }`. The correct way to get the user ID is `req.user.claims.sub` — which is what `server/replit_integrations/auth/routes.ts` does.

However, every inbox route in `server/routes.ts` uses `req.user.id` instead:

```typescript
// lines 1212, 1228, 1241, 1253, 1268 — all wrong
const userId = req.user.id; // undefined — .id doesn't exist on this object
```

`req.user.id` is `undefined` at runtime. Every webhook token upsert and inbox query is using `undefined` as the userId, which means the inbox feature is currently broken for any user who has signed in. This must be fixed as part of this work.

### 4. The `gpx_inbox` table has no source tracking

There is currently no way to distinguish inbox items that arrived via webhook from ones imported from Strava. The UI needs a "Imported from Strava" badge. This requires a `source` column (nullable text, default null) added to `gpx_inbox`.

### 5. OAuth scope for Routes requires `read`, not just `activity:read_all`

Strava's Routes API requires the `read` scope. Activities require `activity:read` (public) or `activity:read_all` (including private). To cover both with one auth flow, request: `read,activity:read_all`.

---

## Revised Architecture

### New database objects

**`strava_connections` table** — one row per connected user:

```sql
CREATE TABLE IF NOT EXISTS strava_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL UNIQUE,         -- Replit OIDC sub claim
  strava_athlete_id integer NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at integer NOT NULL,          -- Unix epoch seconds
  scope text,
  connected_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
```

**`gpx_inbox` schema addition** — `source` column:

```sql
ALTER TABLE gpx_inbox ADD COLUMN IF NOT EXISTS source text;
-- Values: NULL or 'webhook' (existing), 'strava-route', 'strava-activity'
ALTER TABLE gpx_inbox ADD COLUMN IF NOT EXISTS strava_id text;
-- Strava activity/route ID — used to detect duplicate imports
```

Both get added to `runStartupMigrations()` in `server/index.ts`, following the existing pattern.

### Drizzle schema additions (`shared/schema.ts`)

```typescript
// New table
export const stravaConnections = pgTable("strava_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().unique(),
  stravaAthleteId: integer("strava_athlete_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: integer("expires_at").notNull(),       // Unix seconds
  scope: text("scope"),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Add to gpxInbox table definition
source: text("source"),            // 'webhook' | 'strava-route' | 'strava-activity' | null
stravaId: text("strava_id"),       // Strava activity/route ID for dedup
```

### New `IStorage` methods (`server/storage.ts`)

```typescript
// Strava connections
getStravaConnection(userId: string): Promise<StravaConnection | undefined>
upsertStravaConnection(data: InsertStravaConnection): Promise<StravaConnection>
updateStravaTokens(userId: string, accessToken: string, refreshToken: string, expiresAt: number): Promise<void>
deleteStravaConnection(userId: string): Promise<void>
```

`createInboxItem` gets two new optional fields added to its parameter type:
```typescript
createInboxItem(item: {
  userId: string;
  filename: string;
  rawGpx: string;
  gpxStats?: any;
  sourceIp?: string;
  source?: string;       // NEW
  stravaId?: string;     // NEW
}): Promise<GpxInboxItem>
```

### New service module: `server/strava.ts`

This file owns all Strava-specific logic and is the only file that knows about Strava API shapes.

**Token management:**
```typescript
// Returns a valid access token, refreshing if within 5 minutes of expiry
export async function getValidStravaToken(userId: string): Promise<string>
```

This function:
1. Loads the connection from DB
2. Checks `expiresAt` against `Date.now() / 1000 + 300` (5-minute buffer)
3. If expired: `POST https://www.strava.com/oauth/token` with `grant_type: refresh_token`
4. Stores the new token pair to DB via `storage.updateStravaTokens()`
5. Returns the access token

**GPX reconstruction from activity streams:**
```typescript
export function buildGpxFromActivity(
  activity: StravaActivity,
  streams: StravaStreams        // { latlng, altitude?, time }
): string
```

This converts:
- `activity.start_date` (ISO string) → base timestamp Date
- `streams.time.data` (seconds offsets) → per-point ISO timestamps
- `streams.latlng.data` ([[lat, lng], ...]) → trackpoint coordinates
- `streams.altitude.data` (meters, optional) → `<ele>` tags

Output is a complete GPX XML string with `<metadata><time>` set to `activity.start_date`, `<trk><name>` set to `activity.name`, and one `<trkpt>` per stream point. Missing altitude is handled by omitting `<ele>` for that point rather than failing.

**Shared ingestion call:**
```typescript
export async function importGpxToInbox(params: {
  userId: string;
  rawGpx: string;
  filename: string;
  source: 'strava-route' | 'strava-activity';
  stravaId: string;
}): Promise<GpxInboxItem>
```

This is the single function both route and activity imports call. It:
1. Calls `parseGpxData(rawGpx)` from `@shared/gpx-utils` to get stats
2. Calls `storage.createInboxItem({ ...params, gpxStats: stats })`
3. Returns the new inbox item

No object storage. No upload. Two function calls.

### API routes (added to `server/routes.ts`)

All Strava routes are protected by `isAuthenticated` except the OAuth callback.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/strava/auth` | Redirects to Strava OAuth consent page |
| `GET` | `/api/strava/callback` | Exchanges code for tokens, stores connection |
| `GET` | `/api/strava/status` | `{ connected: bool, athleteName?: string }` |
| `DELETE` | `/api/strava/disconnect` | Removes the connection row |
| `GET` | `/api/strava/activities` | Lists recent activities from Strava API (proxied) |
| `GET` | `/api/strava/routes` | Lists athlete routes from Strava API (proxied) |
| `POST` | `/api/strava/import/activity/:stravaId` | Fetch streams → build GPX → inbox |
| `POST` | `/api/strava/import/route/:stravaId` | Export GPX → inbox |

**OAuth flow detail:**

`GET /api/strava/auth`:
```
redirect to:
https://www.strava.com/oauth/authorize
  ?client_id=STRAVA_CLIENT_ID
  &redirect_uri=https://{req.hostname}/api/strava/callback
  &response_type=code
  &scope=read,activity:read_all
  &approval_prompt=auto
```

`GET /api/strava/callback`:
1. Receive `?code=...&scope=...` from Strava
2. `POST https://www.strava.com/oauth/token` to exchange code for tokens
3. Response includes `{ access_token, refresh_token, expires_at, athlete: { id, firstname, lastname } }`
4. `storage.upsertStravaConnection({ userId: req.user.claims.sub, stravaAthleteId: athlete.id, ... })`
5. Redirect to `/inbox`

**Activity import detail (`POST /api/strava/import/activity/:stravaId`):**
1. `getValidStravaToken(userId)` → access token (refreshes if needed)
2. `GET /api/v3/athlete/activities` record is already on the frontend — we only need streams
3. `GET /api/v3/activities/:stravaId` → full activity object (for `name`, `start_date`, `sport_type`)
4. `GET /api/v3/activities/:stravaId/streams?keys=latlng,altitude,time&key_by_type=true`
5. `buildGpxFromActivity(activity, streams)` → raw GPX string
6. `importGpxToInbox({ userId, rawGpx, filename: \`strava_${activity.name}_${stravaId}.gpx\`, source: 'strava-activity', stravaId })` 
7. Return `{ inboxItem }` — frontend appends to inbox list

**Route import detail (`POST /api/strava/import/route/:stravaId`):**
1. `getValidStravaToken(userId)` → access token
2. `GET /api/v3/routes/:stravaId/export_gpx` → raw GPX XML (Strava serves this directly)
3. `GET /api/v3/routes/:stravaId` → route metadata for filename
4. `importGpxToInbox({ userId, rawGpx, filename: \`strava_route_${stravaName}_${stravaId}.gpx\`, source: 'strava-route', stravaId })`
5. Return `{ inboxItem }`

**Duplicate prevention:** Before importing, check `gpxInbox` for an existing row where `userId = userId AND strava_id = stravaId`. If found, return `409 Conflict` with `{ message: "Already in your inbox", inboxItemId }`. Frontend can highlight the existing item instead of importing again.

### Frontend changes (`client/src/pages/inbox.tsx`)

The existing page structure stays. Two additions:

**1. Strava connection banner (top of page, above webhook URL card):**

```
┌─────────────────────────────────────────────────────────┐
│  [Strava logo]  Connect Strava                          │
│  Import activities and routes directly from Strava.    │
│                                    [Connect Strava →]  │
└─────────────────────────────────────────────────────────┘
```

When connected, this becomes:
```
┌─────────────────────────────────────────────────────────┐
│  ✓ Connected as FirstName LastName      [Disconnect]   │
└─────────────────────────────────────────────────────────┘
```

**2. Strava import panel (below the connection banner, above "Received files"):**

Two tabs: **Activities** | **Routes**

Each tab shows a list fetched from `/api/strava/activities` or `/api/strava/routes`. Each row:
```
[activity name]  [sport type badge]  [distance]  [date]   [Import]
Tahoe City Ride  Cycling             23.3 mi      May 10   [↑ Import]
```

The Import button:
- Calls `POST /api/strava/import/activity/:id`
- Shows a spinner while pending
- On success: invalidates `/api/inbox` query → item appears at top of inbox list
- On 409: button changes to "Already imported" (disabled)
- On error: toast with message

The Strava panel is hidden when disconnected. Activities/routes are fetched lazily (only when the panel is open, not on page load).

**Source badges in the inbox list:**

Existing items show nothing. New items show a small badge:
- `source === 'strava-activity'` → orange "Strava Activity" badge
- `source === 'strava-route'` → orange "Strava Route" badge
- `source === 'webhook'` or null → nothing (existing behavior)

### Bug fix: `req.user.id` → `req.user.claims.sub`

All five occurrences in `server/routes.ts` (lines 1212, 1228, 1241, 1253, 1268) must change before the inbox works for anyone. The Strava routes should use `req.user.claims.sub` from the start.

### Environment variables required

Add to Replit Secrets:
- `STRAVA_CLIENT_ID` — from your Strava API application settings
- `STRAVA_CLIENT_SECRET` — from your Strava API application settings

No redirect URI secret needed — it's constructed dynamically from `req.hostname` (matching the Replit Auth pattern already in this codebase).

In your Strava API application, set Authorization Callback Domain to `bigmiles.app`.

---

## Implementation Order

Do these in sequence — each builds on the previous:

1. **Fix `req.user.id` bug** — one-line change ×5 in `server/routes.ts`. Ship this first, the inbox is currently broken.

2. **Schema and migration** — add `strava_connections` table, `source` and `strava_id` columns to `gpx_inbox`, update Drizzle schema in `shared/schema.ts`, add to `runStartupMigrations()`.

3. **Storage methods** — add Strava connection CRUD to `IStorage` interface and `DatabaseStorage` implementation in `server/storage.ts`.

4. **`server/strava.ts` service** — token refresh helper, GPX builder, `importGpxToInbox` function.

5. **API routes** — add all 8 Strava routes to `server/routes.ts`.

6. **Frontend** — update `client/src/pages/inbox.tsx` with connection banner, import panel, and source badges.

---

## What This Plan Deliberately Omits

- **Strava webhook subscription** (real-time push from Strava when you finish an activity) — this is a separate OAuth-protected server endpoint Strava calls. Significant additional complexity. Manual import via the panel is sufficient for v1.

- **Encryption of stored tokens** — for a personal single-user app the DB is the security boundary. Not worth the key management complexity.

- **Pagination of activities/routes** — Strava returns 30 activities per page. Fetching page 1 (most recent 30) covers 99% of use cases. Add pagination if needed later.

- **Deduplication across webhook and Strava imports** — only Strava-to-Strava dedup is implemented (via `strava_id`). A manually exported and re-uploaded GPX of the same activity is not detected as a duplicate.

---

*Revised May 2026 — based on direct inspection of `server/routes.ts`, `server/storage.ts`, `shared/schema.ts`, `shared/models/auth.ts`, `server/replit_integrations/auth/replitAuth.ts`, and `client/src/pages/inbox.tsx`.*
