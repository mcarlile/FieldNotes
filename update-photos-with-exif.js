// Script to update existing photos with real EXIF data
import { neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import * as schema from './shared/schema.js';
import { extractExifData } from './server/exif-extractor.js';

// Set up database connection
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function updatePhotosWithExif() {
  try {
    console.log('Updating all photos with real EXIF data...');
    
    // Get all photos that don't have EXIF data yet
    const photosToUpdate = await db.query.photos.findMany({
      where: (photos, { isNull }) => isNull(photos.camera)
    });
    
    console.log(`Found ${photosToUpdate.length} photos to update`);
    
    for (const photo of photosToUpdate) {
      try {
        console.log(`Processing photo: ${photo.filename} (${photo.url})`);
        
        const exifData = await extractExifData(photo.url);
        
        if (Object.keys(exifData).length > 0) {
          console.log(`Found EXIF data for ${photo.filename}:`, exifData);
          
          // Update the photo with EXIF data
          await db.update(schema.photos)
            .set({
              latitude: exifData.latitude,
              longitude: exifData.longitude,
              elevation: exifData.elevation,
              timestamp: exifData.timestamp,
              camera: exifData.camera,
              lens: exifData.lens,
              aperture: exifData.aperture,
              shutterSpeed: exifData.shutterSpeed,
              iso: exifData.iso,
              focalLength: exifData.focalLength,
              fileSize: exifData.fileSize
            })
            .where(schema.eq(schema.photos.id, photo.id));
          
          console.log(`✓ Updated ${photo.filename} with EXIF data`);
        } else {
          console.log(`No EXIF data found for ${photo.filename}`);
        }
      } catch (error) {
        console.error(`Error processing photo ${photo.filename}:`, error);
      }
    }
    
    console.log('✓ Finished updating photos with EXIF data');
  } catch (error) {
    console.error('Error updating photos with EXIF data:', error);
  } finally {
    await pool.end();
  }
}

// Run the update
updatePhotosWithExif();