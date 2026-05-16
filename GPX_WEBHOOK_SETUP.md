# GPX Webhook Setup Guide
**Big Miles — bigmiles.app**

This guide explains how to automatically send GPX tracks from Strava or any other fitness platform into your Big Miles inbox, so you can import them into your journal with one click.

---

## How it works

Big Miles has a personal webhook URL — a private HTTP endpoint that accepts GPX files from any tool or service. When a file arrives, it lands in your **GPX Inbox** (`/inbox`), where you can review the stats and add it to your journal with a title, description, and trip type.

The flow is:

```
Strava / Garmin / other service
        ↓  (GPX file)
  Your webhook URL
        ↓
    GPX Inbox
        ↓  (you click "Add to journal")
   Field note in Big Miles
```

---

## Step 1 — Find your webhook URL

1. Sign in to [bigmiles.app](https://bigmiles.app)
2. Click **Inbox** in the navigation
3. Your webhook URL is shown at the top of the page. It looks like:
   ```
   https://bigmiles.app/api/webhook/gpx/YOUR_TOKEN_HERE
   ```
4. Click **Copy** to copy it to your clipboard

Keep this URL private — anyone with it can send files to your inbox. If it's ever compromised, click **Regenerate** to get a new one (the old URL stops working immediately).

---

## Step 2 — Test it manually

Before setting up automation, confirm it works. In a terminal, send any `.gpx` file:

```bash
curl -X POST "https://bigmiles.app/api/webhook/gpx/YOUR_TOKEN" \
  -F "file=@mytrack.gpx"
```

You should see a response like:

```json
{ "id": "abc123", "filename": "mytrack.gpx", "receivedAt": "2026-05-16T..." }
```

Then check your inbox — the file should appear with distance and elevation stats already parsed.

---

## Supported formats

The webhook accepts GPX three ways. Use whichever matches your tool:

| Method | How to send |
|---|---|
| **Multipart file** (recommended) | `-F "file=@track.gpx"` — standard file upload |
| **Raw body** | POST the raw GPX XML as the request body; add `-H "X-Filename: track.gpx"` to set the filename |
| **JSON** | `{"gpx": "<gpx>...</gpx>", "filename": "track.gpx"}` |

**Limits:** 20MB per file. Must contain valid GPX XML (`<gpx>` or `<trk>` tag).

---

## Strava setup

Strava does not push GPX files automatically — it has its own webhook system for notifying apps about activity events, but that's JSON metadata, not a GPX file. The practical options are below, from simplest to most automated.

### Option A — Manual export (no setup)

1. Open an activity on [strava.com](https://strava.com)
2. Click the **⋯** menu → **Export GPX**
3. Send it to your webhook:
   ```bash
   curl -X POST "https://bigmiles.app/api/webhook/gpx/YOUR_TOKEN" \
     -F "file=@activity_12345.gpx"
   ```

Good for occasional use. Takes about 30 seconds per activity.

### Option B — Make.com automation (recommended)

[Make.com](https://make.com) (formerly Integromat) has a free tier and connects Strava to HTTP requests.

**Setup:**

1. Create a free account at [make.com](https://make.com)
2. Create a new **Scenario**
3. Add a **Strava** trigger module → choose **Watch Activities**
   - Connect your Strava account when prompted
   - Set it to run every 15 minutes (free tier) or on activity creation
4. Add an **HTTP** action module → **Make a Request**
   - **URL:** your Big Miles webhook URL
   - **Method:** POST
   - **Body type:** Multipart/form-data
   - Add a field: name = `file`, value = map the GPX data from the Strava module

> **Note:** Make's Strava module returns activity data as JSON. To get the actual GPX, add an intermediate **HTTP → Make a Request** step that calls the Strava API:
> `GET https://www.strava.com/api/v3/activities/{{activity_id}}/export_gpx`
> with your Strava Bearer token in the Authorization header.
> Then pass the response body to the webhook as raw body with `Content-Type: application/gpx+xml`.

5. Activate the scenario — new Strava activities will appear in your Big Miles inbox automatically

### Option C — Zapier

[Zapier](https://zapier.com) offers a similar flow:

1. Trigger: **Strava → New Activity**
2. Action: **Webhooks by Zapier → POST**
   - URL: your Big Miles webhook URL
   - Payload type: `form`
   - File field: the GPX export from Strava

Same note as above: Zapier's Strava integration returns JSON. You may need an intermediate step to fetch the GPX from the Strava API using a **Code by Zapier** or **Webhooks by Zapier → GET** step first.

### Option D — Custom script (most reliable)

If you're comfortable with a script, this runs as a cron job and handles everything automatically.

```bash
#!/bin/bash
# strava-to-bigmiles.sh
# Prerequisites: curl, jq, a Strava API refresh token

STRAVA_CLIENT_ID="your_client_id"
STRAVA_CLIENT_SECRET="your_client_secret"
STRAVA_REFRESH_TOKEN="your_refresh_token"
BIGMILES_WEBHOOK="https://bigmiles.app/api/webhook/gpx/YOUR_TOKEN"

# Get a fresh Strava access token
ACCESS_TOKEN=$(curl -s -X POST https://www.strava.com/oauth/token \
  -d client_id=$STRAVA_CLIENT_ID \
  -d client_secret=$STRAVA_CLIENT_SECRET \
  -d grant_type=refresh_token \
  -d refresh_token=$STRAVA_REFRESH_TOKEN \
  | jq -r '.access_token')

# Get most recent activity ID
ACTIVITY_ID=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/athlete/activities?per_page=1" \
  | jq -r '.[0].id')

# Export as GPX and send to Big Miles
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.strava.com/api/v3/activities/$ACTIVITY_ID/export_gpx" \
  | curl -s -X POST "$BIGMILES_WEBHOOK" \
    -H "Content-Type: application/gpx+xml" \
    -H "X-Filename: strava_${ACTIVITY_ID}.gpx" \
    --data-binary @-

echo "Sent activity $ACTIVITY_ID to Big Miles inbox"
```

Run this via cron after workouts, or schedule it with `crontab -e`:
```
0 * * * * /path/to/strava-to-bigmiles.sh
```

---

## Other services

| Service | How to get GPX to your webhook |
|---|---|
| **Garmin Connect** | Activity page → Export to GPX → `curl -F "file=@..."` |
| **Wahoo** | Download GPX from app or web → send via curl or Make |
| **Apple Watch / iPhone** | Use **WorkOutDoors** or **Gaia GPS** — both can export GPX files directly |
| **Garmin watches** | **Connect IQ** apps (e.g. GPX Logger) can push files; alternatively export from Garmin Connect |
| **Komoot** | Tour page → Export GPX → send to webhook |
| **AllTrails** | Activity → Export → GPX → send to webhook |
| **iPhone Shortcuts** | Build a Shortcut that calls your webhook URL with a GPX file attached |

---

## In the inbox

Once a file arrives:

- It shows up instantly under **Received files** with a **Pending** badge
- Distance and elevation are pre-parsed from the GPX
- Click **Add to journal** to open a dialog where you set the title, description, and trip type
- The file is promoted to a full field note — the GPX track, map, and elevation profile are all ready
- Already-imported files stay in the list with an **Added** badge so you know what's been processed

---

## Security

- Your token is 48 random hex characters — effectively unguessable
- The webhook endpoint accepts POST only; no auth header required (the token in the URL is the auth)
- Only GPX content is accepted; the server validates that the body contains valid GPX XML before storing anything
- Regenerate your token any time from the Inbox page if you suspect it's been shared

---

*Last updated: May 2026*
