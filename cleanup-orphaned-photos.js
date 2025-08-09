// Cleanup script for orphaned photo records that point to non-existent files
const { Pool } = require('@neondatabase/serverless');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function cleanupOrphanedPhotos() {
  const client = await pool.connect();
  
  try {
    // Get all photos
    const photosResult = await client.query('SELECT id, filename, url FROM photos');
    const photos = photosResult.rows;
    
    console.log(`Found ${photos.length} photo records in database`);
    
    const orphanedPhotos = [];
    
    // Check each photo URL to see if it's accessible
    for (const photo of photos) {
      try {
        const response = await fetch(`http://localhost:5000${photo.url}`, { method: 'HEAD' });
        if (response.status === 404) {
          orphanedPhotos.push(photo);
          console.log(`Orphaned photo found: ${photo.filename} (${photo.url})`);
        } else {
          console.log(`Photo OK: ${photo.filename}`);
        }
      } catch (error) {
        orphanedPhotos.push(photo);
        console.log(`Error checking photo ${photo.filename}: ${error.message}`);
      }
    }
    
    if (orphanedPhotos.length > 0) {
      console.log(`\nFound ${orphanedPhotos.length} orphaned photo records`);
      console.log('To remove them, run:');
      console.log(`DELETE FROM photos WHERE id IN (${orphanedPhotos.map(p => `'${p.id}'`).join(', ')});`);
    } else {
      console.log('\nNo orphaned photos found!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
  }
}

cleanupOrphanedPhotos();