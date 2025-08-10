# Production Data Sync Instructions

## ✅ Status: Data Sync System Ready

The export/import system is now working correctly. Here's how to sync production data to development:

## Step-by-Step Process

### 1. Export from Production
In your production environment, run:
```bash
npx tsx scripts/export-data.js
```
This creates `data-export.json` with all field notes and photos metadata.

### 2. Transfer Export File
- Download `data-export.json` from production
- Upload it to your development environment (replace the existing one)

### 3. Import to Development (Merge Mode)
```bash
npx tsx scripts/import-data.js --merge
```

## Current Development Data
- **Field Notes**: 2 entries
- **Photos**: 8 entries
- **Export Date**: 2025-08-10

## Test Results ✅
- Export: Successfully exported all data
- Import Merge: Correctly skipped all existing entries (0 imported, 10 skipped)
- Data Integrity: All IDs and relationships preserved

## Important Notes

### What Gets Synced
- ✅ Field notes metadata (title, description, trip type, dates, distances)
- ✅ Photo metadata (EXIF data, GPS coordinates, camera settings)
- ✅ GPX track data for mapping

### What Doesn't Get Synced
- ❌ Actual photo files (stored in separate object storage buckets)
- ❌ Environment-specific configurations

### Merge vs Replace
- **Merge Mode** (`--merge`): Only imports new entries, skips existing IDs
- **Replace Mode** (no flag): Clears all data and imports fresh copy

## Object Storage Considerations
Photos are stored in separate buckets per environment:
- Production photos stay in production bucket
- Development photos stay in development bucket
- Only metadata transfers between environments

## Ready to Use
The system is ready for production sync whenever you need it!