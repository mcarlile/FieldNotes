# Export Data from Production Database

## Step 1: Get Production Database Credentials
1. Go to your deployed Replit app
2. Open the Database tool from left sidebar
3. Click "Commands" tab
4. Copy the `DATABASE_URL` from Environment variables section

## Step 2: Connect to Production Database
In your production environment, set the DATABASE_URL and run the export:

```bash
# Set your production DATABASE_URL (copy from Database tool)
export DATABASE_URL="your_production_database_url_here"

# Export the data
npx tsx scripts/export-data.js
```

## Step 3: Download Export File
Download the generated `data-export.json` file from your production environment.

## Step 4: Import to Development
Upload the production `data-export.json` to your development environment and run:

```bash
# Merge production data into development
npx tsx scripts/import-data.js --merge
```

## Alternative: Direct SQL Access
You can also use any PostgreSQL client (like pgAdmin, DBeaver, or psql) with your production credentials to directly query or export data.

## Important Notes
- Production database is PostgreSQL 16 on Neon
- All credentials are automatically managed by Replit
- Use connection pooling for high-traffic production apps
- Never commit production credentials to your code repository