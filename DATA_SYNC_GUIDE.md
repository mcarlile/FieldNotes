# Data Synchronization Guide

This guide explains how to synchronize data between your development and production environments.

## Current Setup

- **Development**: Local Replit PostgreSQL database
- **Production**: Separate deployed PostgreSQL database  
- **Data**: Field notes, photos, and EXIF metadata are stored separately in each environment

## Synchronization Methods

### Method 1: Export/Import Scripts (Recommended)

Use the provided scripts to move data between environments:

#### From Production to Development

1. **Export from production**:
   ```bash
   # Connect to your production environment and run:
   node scripts/export-data.js
   ```
   This creates a `data-export.json` file with all your data.

2. **Transfer the export file**:
   - Download `data-export.json` from production
   - Upload it to your development environment root directory

3. **Import to development**:
   ```bash
   # In development, choose one:
   npm run data:import          # Replace all data
   npm run data:import:merge    # Merge with existing data
   ```

#### From Development to Production

1. **Export from development**:
   ```bash
   npm run data:export
   ```

2. **Import to production**:
   - Transfer `data-export.json` to production
   - Run the import script in production environment

### Method 2: Database Dump/Restore

For large datasets, use PostgreSQL's native tools:

```bash
# Export from production
pg_dump $PRODUCTION_DATABASE_URL > field_notes_backup.sql

# Import to development  
psql $DATABASE_URL < field_notes_backup.sql
```

### Method 3: API-Based Sync

For real-time sync, you could implement API endpoints to sync specific records.

## File Considerations

**Important**: Photos are stored in separate object storage buckets per environment. The sync scripts only transfer metadata. For photos:

1. **Object Storage**: Each environment has its own bucket
2. **URLs**: Photo URLs will differ between environments
3. **Manual Transfer**: Photos need to be manually copied between object storage buckets if needed

## Best Practices

1. **Development Workflow**:
   - Start development with production data export
   - Work with real data locally
   - Export changes when moving features to production

2. **Backup Strategy**:
   - Always export data before major changes
   - Keep dated backups: `data-export-2025-08-10.json`

3. **Merge vs Replace**:
   - Use `--merge` when adding new data to existing set
   - Use replace when you want exact copy of source environment

## Environment Variables

Make sure both environments have:
- `DATABASE_URL` - PostgreSQL connection string
- `MAPBOX_ACCESS_TOKEN` - For map functionality (can be same token)
- Object storage configuration (separate buckets per environment)

## Troubleshooting

- **Import fails**: Check that field note IDs don't conflict
- **Photos missing**: Remember photos are stored separately per environment
- **Database errors**: Ensure schema is up to date in both environments

## Security Notes

- Never commit `data-export.json` files to git (contains real data)
- Use environment-specific database credentials
- Keep production and development object storage separate