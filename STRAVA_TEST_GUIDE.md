# Testing the Shared Strava Connection

This guide walks you through testing the new one-click Strava connection. Your
users no longer need to create their own Strava developer app — everyone connects
through a single shared app that you set up once.

---

## Before you start (one-time setup)

You only need to do this once, as the app owner.

1. **Create one Strava app** at <https://www.strava.com/settings/api>.
   - Set the **Authorization Callback Domain** to your app's domain
     (for example, `your-app-name.replit.app`). Use the domain only — no
     `https://` and no path.
2. **Copy the Client ID and Client Secret** from that Strava app.
3. These are stored as the `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` secrets.
   They are already set in this project — you do not need to re-enter them unless
   you change the Strava app.

> Tip: For the full end-to-end flow (the redirect back from Strava), test on your
> **published** app rather than the in-editor preview, so the callback domain
> matches what you registered with Strava.

---

## Test 1: Connect your Strava account

1. Sign in to the app.
2. Go to the **Inbox** page (`/inbox`).
3. Find the **Strava** section near the top.
   - ✅ You should see: *"Connect Strava to import activities and routes directly
     into your inbox."* with a **Connect Strava →** link.
   - ❌ If you see *"Strava integration is not configured yet"*, the secrets are
     missing — re-check the one-time setup above.
4. Click **Connect Strava →**.
   - You'll be sent to Strava's authorization page.
5. Click **Authorize** on Strava.
   - ✅ You should be sent back to the Inbox, now showing **Strava connected ·
     #yourAthleteId** with a green check.

**What this proves:** Users can connect with a single click — no developer app
setup on their end.

---

## Test 2: Browse your activities and routes

1. While connected, stay on the **Inbox** page.
2. Use the **Activities** and **Routes** tabs in the Strava section.
   - ✅ Your recent Strava activities and routes should list out.

---

## Test 3: Import an activity into your journal

1. Pick any activity (or route) in the list and click its **import / add** action.
   - ✅ A success message appears ("Added to inbox").
2. Scroll down to the inbox list below.
   - ✅ The imported item appears with its distance / elevation stats.
3. Use **Add to journal** on that item, fill in a title and trip type, and save.
   - ✅ It becomes a full field note in your journal.
4. (Optional) Try importing the **same** activity again.
   - ✅ You should be told it's *already in your inbox / journal* rather than
     getting a duplicate.

---

## Test 4: Disconnect

1. Back in the **Strava** section of the Inbox, click **Disconnect**.
   - ✅ The section returns to the **Connect Strava** state.
2. Reconnect with **Connect Strava →** to confirm the round trip still works.

---

## Confirming the per-user setup is gone

The point of this change is that users never bring their own Strava app. To
confirm nothing asks for that anymore:

- ✅ There are **no fields** anywhere asking for a Strava *Client ID* or
  *Client Secret*.
- ✅ There are **no instructions** telling a user to whitelist a callback /
  redirect URL in their own Strava app.
- The only Strava actions a user ever sees are **Connect**, **Disconnect**, and
  importing activities/routes.

---

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| "Strava integration is not configured yet" | `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` not set | Add the secrets from your Strava app |
| Redirected back with an error after authorizing | Callback domain mismatch | Make sure the Strava app's Authorization Callback Domain matches your published domain (no `https://`, no path) |
| Activities/routes won't load after connecting | Token expired or scope issue | Disconnect and reconnect |
| Works in editor preview but not published (or vice-versa) | Each environment has its own domain | Test on the domain registered with Strava — usually the published app |
