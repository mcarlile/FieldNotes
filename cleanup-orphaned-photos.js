// Script to clean up photos with expired signed URLs and reset EXIF data for testing
import { neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import ws from 'ws';

// Set up database connection
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

async function cleanupPhotos() {
  try {
    console.log('Cleaning up photos with expired URLs and resetting EXIF data...');
    
    // Reset all EXIF data to null so we can test real extraction
    const result = await db.execute(`
      UPDATE photos SET 
        latitude = NULL,
        longitude = NULL,
        elevation = NULL,
        timestamp = NULL,
        camera = NULL,
        lens = NULL,
        aperture = NULL,
        shutter_speed = NULL,
        iso = NULL,
        focal_length = NULL,
        file_size = NULL
    `);
    
    console.log(`✓ Reset EXIF data for ${result.rowCount} photos`);
    console.log('Photos are now ready for real EXIF extraction from new uploads!');
  } catch (error) {
    console.error('Error cleaning up photos:', error);
  } finally {
    await pool.end();
  }
}

// Run the cleanup
cleanupPhotos();