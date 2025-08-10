#!/usr/bin/env node

/**
 * Import field notes and photos data from JSON file to database
 * Usage: node scripts/import-data.js [--merge]
 * 
 * --merge: Merge with existing data (skip duplicates by ID)
 * without --merge: Replace all data (clears existing data first)
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { fieldNotes, photos } from '../shared/schema.ts';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function importData() {
  const mergeMode = process.argv.includes('--merge');
  
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const exportPath = join(__dirname, '..', 'data-export.json');
  
  if (!existsSync(exportPath)) {
    console.error(`❌ Export file not found: ${exportPath}`);
    console.log('Run "node scripts/export-data.js" first to create an export');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    const exportData = JSON.parse(readFileSync(exportPath, 'utf8'));
    
    console.log(`📊 Import data from: ${exportData.exportedAt}`);
    console.log(`📝 Field Notes: ${exportData.totalFieldNotes}`);
    console.log(`📷 Photos: ${exportData.totalPhotos}`);
    console.log(`🔄 Mode: ${mergeMode ? 'MERGE' : 'REPLACE'}`);
    
    if (!mergeMode) {
      console.log('🗑️  Clearing existing data...');
      await db.delete(photos); // Delete photos first due to foreign key
      await db.delete(fieldNotes);
    }
    
    console.log('📝 Importing field notes...');
    let importedFieldNotes = 0;
    let skippedFieldNotes = 0;
    
    for (const note of exportData.fieldNotes) {
      try {
        if (mergeMode) {
          // Check if already exists
          const existing = await db.select().from(fieldNotes).where(eq(fieldNotes.id, note.id));
          if (existing.length > 0) {
            skippedFieldNotes++;
            continue;
          }
        }
        
        await db.insert(fieldNotes).values({
          ...note,
          date: new Date(note.date),
          createdAt: new Date(note.createdAt)
        });
        importedFieldNotes++;
      } catch (error) {
        console.warn(`⚠️  Skipped field note ${note.id}:`, error.message);
        skippedFieldNotes++;
      }
    }
    
    console.log('📷 Importing photos...');
    let importedPhotos = 0;
    let skippedPhotos = 0;
    
    for (const photo of exportData.photos) {
      try {
        if (mergeMode) {
          // Check if already exists
          const existing = await db.select().from(photos).where(eq(photos.id, photo.id));
          if (existing.length > 0) {
            skippedPhotos++;
            continue;
          }
        }
        
        await db.insert(photos).values({
          ...photo,
          timestamp: photo.timestamp ? new Date(photo.timestamp) : null,
          createdAt: new Date(photo.createdAt)
        });
        importedPhotos++;
      } catch (error) {
        console.warn(`⚠️  Skipped photo ${photo.id}:`, error.message);
        skippedPhotos++;
      }
    }
    
    console.log(`✅ Import completed successfully!`);
    console.log(`📝 Field Notes: ${importedFieldNotes} imported, ${skippedFieldNotes} skipped`);
    console.log(`📷 Photos: ${importedPhotos} imported, ${skippedPhotos} skipped`);
    
  } catch (error) {
    console.error('❌ Import failed:', error);
  } finally {
    await pool.end();
  }
}

importData();