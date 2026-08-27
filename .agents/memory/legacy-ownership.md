---
name: Legacy ownership after auth migration
description: How to handle records that predate per-user ownership when authentication starts supporting distinct identities.
---

Records created before ownership tracking must not be automatically assigned to an arbitrary migrated user. Keep their owner unset and exclude them from private lists, mutations, and relationship writes until ownership is explicitly assigned.

**Why:** The previous data model did not record who created a field note, so assigning legacy rows to the first or current user would guess at ownership and could expose another person's data.

**How to apply:** New records always receive the authenticated local user ID from the server. Private reads and writes require an exact owner match; public access remains limited to explicit published routes.