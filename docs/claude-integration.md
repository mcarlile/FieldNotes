# Claude integration (MCP)

Big Miles serves a small [Model Context Protocol](https://modelcontextprotocol.io) server at `POST /mcp`, so Claude can create TrailCam Studio projects and add video clips for you.

## Connect

1. Open **TrailCam Studio → Connect Claude** (`/connect-claude`) and create a token. It is shown once; only its SHA-256 hash is stored. Revoke it on the same page.
2. Give the token to Claude:
   - **Claude Code**: `claude mcp add --transport http big-miles https://bigmiles.app/mcp --header "Authorization: Bearer bm_…"`
   - **A Claude cloud environment**: store it as an environment secret (for example `BIG_MILES_TOKEN`) and have Claude call the endpoint with `Authorization: Bearer $BIG_MILES_TOKEN`.

Tokens can only be created or revoked from a signed-in browser session, so a token can't mint other tokens. A token can otherwise do anything your account can.

## Tools

| Tool | What it does |
| --- | --- |
| `list_projects` | Lists projects, newest first. |
| `get_project` | One project, with its route start and clips (including processing status). |
| `request_upload` | Returns a signed `upload_url` (valid 15 minutes) and an `object_path`. PUT the raw file to the URL: `curl -T clip.mp4 -H 'Content-Type: video/mp4' "$upload_url"`. Files don't pass through MCP and aren't limited to the web uploader's 1.5 GB. |
| `create_project` | Creates a project from GPX, inline (`gpx`) or uploaded (`gpx_object_path`). The first timed track point becomes the route start. |
| `add_clip` | Adds an uploaded video. Place it with `recorded_at` (UTC start, e.g. the camera original's `creation_time`) or `start_seconds` after the route start. Transcoding runs in the background. |

## Example flow

1. `create_project` with the ride's GPX.
2. For each video: `request_upload` → PUT the file → `add_clip` with the `object_path`, `duration_seconds` and `recorded_at`.
3. `get_project` until each clip's `processing_status` is `ready`.
