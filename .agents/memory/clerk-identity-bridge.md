---
name: Clerk identity bridge
description: Rules for preserving the local user relationship after the Replit Auth to Clerk migration.
---

For local application database lookups, use `sessionClaims.userId` and the resolved local user record. Reserve Clerk's native `auth.userId` for Clerk API calls only.

**Why:** Migrated users retain their former subject as a Clerk external ID, so the Clerk-native ID does not match their existing application records.

**How to apply:** New protected server code should run through the shared Clerk authentication middleware and use the attached local user for ownership checks, storage calls, and application authorization. Browser UI can display Clerk profile data directly.

For cross-environment private previews, require an exact match of the preserved local account ID in both environments. Do not map owners by email, even a verified one.

**Why:** Email can become stale or be reassigned, which could expose a previous owner's private production records. A missing ID match must fail closed rather than guessing an owner.

**How to apply:** A preview may transport the authenticated local ID over a server-only channel; the production side must still enforce that ID on every private data read.