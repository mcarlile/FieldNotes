---
name: Clerk identity bridge
description: Rules for preserving the local user relationship after the Replit Auth to Clerk migration.
---

For local application database lookups, use `sessionClaims.userId` and the resolved local user record. Reserve Clerk's native `auth.userId` for Clerk API calls only.

**Why:** Migrated users retain their former subject as a Clerk external ID, so the Clerk-native ID does not match their existing application records.

**How to apply:** New protected server code should run through the shared Clerk authentication middleware and use the attached local user for ownership checks, storage calls, and application authorization. Browser UI can display Clerk profile data directly.