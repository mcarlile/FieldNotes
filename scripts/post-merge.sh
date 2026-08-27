#!/bin/bash
set -e

# Post-merge runs without an interactive stdin. Keep installs quiet and
# use a terminal-aware wrapper that preserves rows when adding a unique
# constraint and rejects unknown destructive schema changes.
npm install --no-audit --no-fund --prefer-offline
python3 scripts/drizzle-push-safe.py
