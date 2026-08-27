---
name: Safe Drizzle post-merge pushes
description: Why automatic schema pushes need terminal-aware, non-destructive prompt handling.
---

Drizzle Kit's unique-constraint confirmation uses a raw terminal menu that can
ignore ordinary piped input, including `yes` and redirected newlines.

**Why:** A post-merge schema push waited indefinitely at the menu despite stdin
being piped. Auto-approving with `--force` was unacceptable because it may
truncate populated tables.

**How to apply:** Keep post-merge schema pushes terminal-aware. Select the
default option that adds unique constraints without truncation, reject unknown
data-loss confirmations, and retain a bounded timeout with clear failure output.