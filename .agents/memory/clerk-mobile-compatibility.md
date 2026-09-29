---
name: Clerk mobile compatibility
description: Authentication boundary between the cookie-based web app and existing native clients.
---

Browser API calls use Clerk cookies only. Existing native clients authenticate in a Clerk browser session, then receive an expiring, revocable mobile bearer token for API calls.

**Why:** Native clients do not share the browser cookie jar, while storing a single short-lived Clerk session JWT would expire without a native refresh SDK. The handoff preserves the existing deep-link contract without restoring Replit Auth.

**How to apply:** Keep mobile-token issuance behind a verified Clerk session, enforce expiry on every request, and revoke server-side tokens before clearing local device storage at sign-out. Never add bearer-token handling to the web client.