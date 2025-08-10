#!/usr/bin/env node

/**
 * Export field notes and photos data from the database to JSON files
 * Usage: node scripts/export-data.js
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { fieldNotes, photos } from '../shared/schema.js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function exportData() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    console.log('Exporting field notes...');
    const fieldNotesData = await db.select().from(fieldNotes);
    
    console.log('Exporting photos...');
    const photosData = await db.select().from(photos);

    const exportData = {
      fieldNotes: fieldNotesData,
      photos: photosData,
      exportedAt: new Date().toISOString(),
      totalFieldNotes: fieldNotesData.length,
      totalPhotos: photosData.length
    };

    const exportPath = join(__dirname, '..', 'data-export.json');
    writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    console.log(`✅ Successfully exported ${fieldNotesData.length} field notes and ${photosData.length} photos`);
    console.log(`📄 Export saved to: ${exportPath}`);
    
  } catch (error) {
    console.error('❌ Export failed:', error);
  } finally {
    await pool.end();
  }
}

exportData();