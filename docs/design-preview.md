# Read-only production data in the development preview

The development app shows live production records by default when both
`DESIGN_PREVIEW_SHARED_SECRET` and `DESIGN_PREVIEW_PRODUCTION_URL` are set in
development. The app does not copy records into the development database.
Design and Build modes share this same development app; switching workspace
modes does not switch the data source.

## Required one-time production setup

1. Add `DESIGN_PREVIEW_SHARED_SECRET` to **Production app secrets** in
   Publishing settings. Use the **same** long random value already supplied
   in development. Do not put it in source code or send it through chat.
2. Publish the updated application. Until the new published server is running,
   the development preview will report that production data is unavailable
   rather than silently showing unrelated development records.

The browser never receives the shared secret. The development server verifies
the viewer's Clerk session, forwards its preserved local account ID, and the
published server returns only records owned by that exact account ID. Users
without a matching production account cannot view another account's data.
Photo URLs point to production object storage. Development API writes are
blocked, and editing screens are replaced with a read-only notice. Production
app behavior is unchanged.

The preview includes field notes, photos, expeditions, inbox items, and
currently public TrailCam project/clip metadata. It deliberately does **not**
expose webhook tokens or Strava credentials/actions. Live Strava activity
feeds are not included because token refresh can write to production.