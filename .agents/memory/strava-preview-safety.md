---
name: Strava preview safety
description: Why preview feed availability must not override read-only production access.
---

Prefer an explicitly unavailable Strava preview over refreshing production authorization or silently falling back to development data.

**Why:** Strava feeds are fetched on demand rather than persisted, and normal feed reads can refresh OAuth credentials. The production design preview is required to leave live credentials and imported records untouched, even when that prevents showing a feed.

**How to apply:** Keep preview authorization separate from the normal token-refreshing client. Any future caching or renewal feature must preserve this boundary; renewal belongs to the live app, not preview.