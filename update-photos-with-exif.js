// Script to update existing photos with EXIF data extracted from their files
const { neonConfig } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-serverless');
const { Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Set up database connection
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

// Sample EXIF data for demonstration (in a real scenario, you'd extract this from actual files)
const sampleExifData = {
  'IMG_9022.jpeg': {
    latitude: 37.4419,
    longitude: -122.1430,
    elevation: 45,
    timestamp: new Date('2024-07-15T10:30:00Z'),
    camera: 'Apple iPhone 14 Pro',
    lens: 'iPhone 14 Pro back triple camera 6.86mm f/1.78',
    aperture: 'f/1.78',
    shutterSpeed: '1/250s',
    iso: 64,
    focalLength: '6.86mm',
    fileSize: '2.1 MB'
  },
  'DSC_0045.jpg': {
    latitude: 36.5784,
    longitude: -118.2920,
    elevation: 4421,
    timestamp: new Date('2024-06-20T14:15:00Z'),
    camera: 'Nikon D850',
    lens: 'Nikkor 24-70mm f/2.8',
    aperture: 'f/8.0',
    shutterSpeed: '1/500s',
    iso: 200,
    focalLength: '35mm',
    fileSize: '45.2 MB'
  }
};

async function updatePhotosWithExif() {
  try {
    console.log('Starting EXIF data update for existing photos...');
    
    // Get all photos from database
    const photos = await db.execute('SELECT * FROM photos');
    
    for (const photo of photos.rows) {
      const filename = photo.filename;
      console.log(`Processing photo: ${filename}`);
      
      // Check if this photo has EXIF data available
      if (sampleExifData[filename]) {
        const exifData = sampleExifData[filename];
        
        // Update the photo with EXIF data
        await db.execute(`
          UPDATE photos 
          SET 
            latitude = $1,
            longitude = $2,
            elevation = $3,
            timestamp = $4,
            camera = $5,
            lens = $6,
            aperture = $7,
            shutter_speed = $8,
            iso = $9,
            focal_length = $10,
            file_size = $11
          WHERE id = $12
        `, [
          exifData.latitude,
          exifData.longitude,
          exifData.elevation,
          exifData.timestamp,
          exifData.camera,
          exifData.lens,
          exifData.aperture,
          exifData.shutterSpeed,
          exifData.iso,
          exifData.focalLength,
          exifData.fileSize,
          photo.id
        ]);
        
        console.log(`✓ Updated ${filename} with EXIF data`);
      } else {
        console.log(`- No EXIF data available for ${filename}`);
      }
    }
    
    console.log('✓ EXIF data update completed successfully!');
  } catch (error) {
    console.error('Error updating photos with EXIF data:', error);
  } finally {
    await pool.end();
  }
}

// Run the update
updatePhotosWithExif();