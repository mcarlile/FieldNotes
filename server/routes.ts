import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertFieldNoteSchema, insertPhotoSchema, insertTrailcamProjectSchema, insertVideoClipSchema } from "@shared/schema";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { extractExifData, extractExifFromBuffer } from "./exif-extractor";
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';

const CHUNK_UPLOAD_DIR = '/tmp/video-chunks';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB
const MAX_CHUNKS = 200; // 200 chunks * 10MB = 2GB max
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup old uploads periodically
const activeUploads = new Map<string, { startTime: number; totalChunks: number; receivedChunks: Set<number> }>();

if (!fs.existsSync(CHUNK_UPLOAD_DIR)) {
  fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
}

// Clean up stale uploads on startup and periodically
function cleanupStaleUploads() {
  const now = Date.now();
  for (const [key, data] of activeUploads.entries()) {
    if (now - data.startTime > UPLOAD_TIMEOUT_MS) {
      const chunkDir = path.join(CHUNK_UPLOAD_DIR, key);
      if (fs.existsSync(chunkDir)) {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      }
      activeUploads.delete(key);
      console.log(`Cleaned up stale upload: ${key}`);
    }
  }
}
setInterval(cleanupStaleUploads, 5 * 60 * 1000); // Run every 5 minutes

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all field notes with optional filters (includes photo count)
  app.get("/api/field-notes", async (req, res) => {
    try {
      const { search, tripType, sortOrder } = req.query;
      const fieldNotes = await storage.getFieldNotes({
        search: search as string,
        tripType: tripType as string,
        sortOrder: sortOrder as 'recent' | 'oldest' | 'name',
      });
      
      // Fetch photo counts for all field notes efficiently
      const fieldNotesWithCounts = await Promise.all(
        fieldNotes.map(async (note) => {
          const photos = await storage.getPhotosByFieldNoteId(note.id);
          return {
            ...note,
            photoCount: photos.length,
          };
        })
      );
      
      res.json(fieldNotesWithCounts);
    } catch (error) {
      console.error("Error fetching field notes:", error);
      res.status(500).json({ message: "Failed to fetch field notes" });
    }
  });

  // Get specific field note by ID with photos included
  app.get("/api/field-notes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const fieldNote = await storage.getFieldNoteById(id);
      if (!fieldNote) {
        return res.status(404).json({ message: "Field note not found" });
      }
      
      // Also fetch photos in the same request to reduce round trips
      const photos = await storage.getPhotosByFieldNoteId(id);
      const fieldNoteWithPhotos = {
        ...fieldNote,
        photos
      };
      
      // Add cache headers for better performance
      res.set('Cache-Control', 'public, max-age=300'); // 5 minutes cache
      res.json(fieldNoteWithPhotos);
    } catch (error) {
      console.error("Error fetching field note:", error);
      res.status(500).json({ message: "Failed to fetch field note" });
    }
  });

  // Get photos for a specific field note
  app.get("/api/field-notes/:id/photos", async (req, res) => {
    try {
      const { id } = req.params;
      const photos = await storage.getPhotosByFieldNoteId(id);
      res.json(photos);
    } catch (error) {
      console.error("Error fetching photos:", error);
      res.status(500).json({ message: "Failed to fetch photos" });
    }
  });

  // Get specific photo by ID
  app.get("/api/photos/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const photo = await storage.getPhotoById(id);
      if (!photo) {
        return res.status(404).json({ message: "Photo not found" });
      }
      res.json(photo);
    } catch (error) {
      console.error("Error fetching photo:", error);
      res.status(500).json({ message: "Failed to fetch photo" });
    }
  });

  // Extract EXIF data from an uploaded photo with optimized limits
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
      fileSize: 50 * 1024 * 1024, // 50MB limit
      files: 1,
      fieldSize: 1024 * 1024, // 1MB field limit
      fields: 10 // Max 10 fields
    },
    fileFilter: (req, file, cb) => {
      // Only accept image files
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'), false);
      }
    }
  });
  
  app.post("/api/photos/extract-exif", upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No photo file provided" });
      }

      console.log(`Extracting EXIF from uploaded file: ${req.file.originalname} (${req.file.size} bytes)`);
      
      // Add timeout for EXIF processing
      const exifData = await Promise.race([
        extractExifFromBuffer(req.file.buffer, req.file.originalname),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('EXIF extraction timeout')), 10000)
        )
      ]);
      
      res.json({
        filename: req.file.originalname,
        fileSize: `${Math.round(req.file.size / 1024)} KB`,
        ...exifData
      });
    } catch (error) {
      console.error("Error extracting EXIF from uploaded photo:", error);
      if (error.message === 'EXIF extraction timeout') {
        res.status(408).json({ message: "EXIF extraction timed out" });
      } else {
        res.status(500).json({ message: "Failed to extract EXIF data" });
      }
    }
  });

  // Extract EXIF data from an existing photo URL
  app.post("/api/photos/extract-exif-from-url", async (req, res) => {
    try {
      const { photoUrl } = req.body;
      if (!photoUrl) {
        return res.status(400).json({ message: "Photo URL is required" });
      }

      console.log(`Extracting EXIF from photo URL: ${photoUrl}`);
      const exifData = await extractExifData(photoUrl);
      
      res.json(exifData);
    } catch (error) {
      console.error("Error extracting EXIF from photo URL:", error);
      res.status(500).json({ message: "Failed to extract EXIF data" });
    }
  });

  // Update all existing photos with EXIF data
  app.post("/api/photos/update-all-exif", async (req, res) => {
    try {
      console.log('Starting batch EXIF extraction for all photos...');
      
      // Get all photos without EXIF data
      const photos = await storage.getPhotosByFieldNoteId('');
      const photosWithoutExif = photos.filter(p => !p.camera);
      
      console.log(`Found ${photosWithoutExif.length} photos without EXIF data`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const photo of photosWithoutExif) {
        try {
          console.log(`Processing ${photo.filename}...`);
          const exifData = await extractExifData(photo.url);
          
          if (Object.keys(exifData).length > 0) {
            await storage.updatePhoto(photo.id, {
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
            });
            console.log(`✓ Updated ${photo.filename}`);
            successCount++;
          }
        } catch (error) {
          console.error(`Error updating ${photo.filename}:`, error);
          errorCount++;
        }
      }
      
      res.json({
        message: `EXIF extraction complete`,
        processed: photosWithoutExif.length,
        successful: successCount,
        errors: errorCount
      });
    } catch (error) {
      console.error("Error updating photos with EXIF:", error);
      res.status(500).json({ message: "Failed to update photos with EXIF data" });
    }
  });

  // Create new field note
  app.post("/api/field-notes", async (req, res) => {
    try {
      // Extract photos from the request body
      const { photos: photosData, ...fieldNoteData } = req.body;
      
      // Convert string date to Date object
      const bodyWithDate = {
        ...fieldNoteData,
        date: fieldNoteData.date ? new Date(fieldNoteData.date) : undefined
      };
      
      const result = insertFieldNoteSchema.safeParse(bodyWithDate);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid field note data",
          errors: result.error.errors 
        });
      }
      
      const fieldNote = await storage.createFieldNote(result.data);
      
      // Create photos if provided
      if (photosData && Array.isArray(photosData)) {
        await storage.updateFieldNotePhotos(fieldNote.id, photosData);
      }
      
      res.status(201).json(fieldNote);
    } catch (error) {
      console.error("Error creating field note:", error);
      res.status(500).json({ message: "Failed to create field note" });
    }
  });

  // Update field note
  app.put("/api/field-notes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Extract photos from the request body
      const { photos: photosData, ...fieldNoteData } = req.body;
      
      // Convert string date to Date object
      const bodyWithDate = {
        ...fieldNoteData,
        date: fieldNoteData.date ? new Date(fieldNoteData.date) : undefined
      };
      
      const result = insertFieldNoteSchema.safeParse(bodyWithDate);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid field note data",
          errors: result.error.errors 
        });
      }
      
      // Update the field note
      const fieldNote = await storage.updateFieldNote(id, result.data);
      if (!fieldNote) {
        return res.status(404).json({ message: "Field note not found" });
      }
      
      // Update photos if provided
      if (photosData && Array.isArray(photosData)) {
        await storage.updateFieldNotePhotos(id, photosData);
      }
      
      res.json(fieldNote);
    } catch (error) {
      console.error("Error updating field note:", error);
      res.status(500).json({ message: "Failed to update field note" });
    }
  });

  // Delete field note
  app.delete("/api/field-notes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteFieldNote(id);
      if (!deleted) {
        return res.status(404).json({ message: "Field note not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting field note:", error);
      res.status(500).json({ message: "Failed to delete field note" });
    }
  });

  // Object Storage endpoints for photo uploads
  const objectStorageService = new ObjectStorageService();

  // Endpoint to get upload URL for photos (both POST and PUT for compatibility)
  app.post("/api/photos/upload", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Generic object storage upload endpoint (for videos and other files)
  app.post("/api/objects/upload", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Remove the PUT endpoint as it conflicts with Vite routing
  // The POST endpoint above handles upload URL requests

  // Endpoint to create photo record after upload and extract EXIF data
  app.post("/api/photos", async (req, res) => {
    try {
      const validatedData = insertPhotoSchema.parse(req.body);
      
      // Normalize the URL if it's a full storage URL
      if (validatedData.url) {
        validatedData.url = objectStorageService.normalizeObjectEntityPath(validatedData.url);
      }
      
      // Create the photo record first and return immediately
      const photo = await storage.createPhoto(validatedData);
      res.status(201).json(photo);
      
      // Process EXIF data asynchronously in the background
      // This prevents blocking the response and improves upload performance
      setImmediate(async () => {
        try {
          console.log(`Background EXIF processing for photo: ${photo.url}`);
          
          const exifData = await Promise.race([
            extractExifData(photo.url),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Background EXIF extraction timeout')), 30000)
            )
          ]);
          
          if (Object.keys(exifData).length > 0) {
            console.log(`Background EXIF data found for ${photo.id}:`, exifData);
            
            await storage.updatePhoto(photo.id, {
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
            });
            
            console.log(`Background EXIF processing complete for photo: ${photo.id}`);
          }
        } catch (exifError) {
          console.warn(`Background EXIF processing failed for photo ${photo.url}:`, exifError.message);
        }
      });
    } catch (error) {
      console.error("Error creating photo:", error);
      res.status(500).json({ error: "Failed to create photo" });
    }
  });

  // Endpoint to serve uploaded photos
  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error(`Error serving photo ${req.path}:`, error);
      if (error instanceof ObjectNotFoundError) {
        // Return a placeholder image or proper 404 response
        return res.status(404).json({ error: "Photo not found", path: req.path });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Endpoint to serve public assets
  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      await objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== TrailCam Studio API Routes ===============

  // Get all TrailCam projects
  app.get("/api/trailcam-projects", async (req, res) => {
    try {
      const { search, sortOrder } = req.query;
      const projects = await storage.getTrailcamProjects({
        search: search as string,
        sortOrder: sortOrder as 'recent' | 'oldest' | 'name',
      });
      res.json(projects);
    } catch (error) {
      console.error("Error fetching TrailCam projects:", error);
      res.status(500).json({ message: "Failed to fetch TrailCam projects" });
    }
  });

  // Get specific TrailCam project by ID
  app.get("/api/trailcam-projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const project = await storage.getTrailcamProjectById(id);
      if (!project) {
        return res.status(404).json({ message: "TrailCam project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error fetching TrailCam project:", error);
      res.status(500).json({ message: "Failed to fetch TrailCam project" });
    }
  });

  // Create new TrailCam project
  app.post("/api/trailcam-projects", async (req, res) => {
    try {
      const validatedData = insertTrailcamProjectSchema.parse(req.body);
      const project = await storage.createTrailcamProject(validatedData);
      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating TrailCam project:", error);
      res.status(400).json({ message: "Failed to create TrailCam project" });
    }
  });

  // Update TrailCam project
  app.put("/api/trailcam-projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertTrailcamProjectSchema.partial().parse(req.body);
      const project = await storage.updateTrailcamProject(id, validatedData);
      if (!project) {
        return res.status(404).json({ message: "TrailCam project not found" });
      }
      res.json(project);
    } catch (error) {
      console.error("Error updating TrailCam project:", error);
      res.status(400).json({ message: "Failed to update TrailCam project" });
    }
  });

  // Delete TrailCam project
  app.delete("/api/trailcam-projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteTrailcamProject(id);
      if (!deleted) {
        return res.status(404).json({ message: "TrailCam project not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting TrailCam project:", error);
      res.status(500).json({ message: "Failed to delete TrailCam project" });
    }
  });

  // Get video clips for a project
  app.get("/api/video-clips", async (req, res) => {
    try {
      const { projectId } = req.query;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }
      const clips = await storage.getVideoClipsByProjectId(projectId as string);
      res.json(clips);
    } catch (error) {
      console.error("Error fetching video clips:", error);
      res.status(500).json({ message: "Failed to fetch video clips" });
    }
  });

  // Get specific video clip by ID
  app.get("/api/video-clips/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const clip = await storage.getVideoClipById(id);
      if (!clip) {
        return res.status(404).json({ message: "Video clip not found" });
      }
      res.json(clip);
    } catch (error) {
      console.error("Error fetching video clip:", error);
      res.status(500).json({ message: "Failed to fetch video clip" });
    }
  });

  // Create new video clip
  app.post("/api/video-clips", async (req, res) => {
    try {
      const validatedData = insertVideoClipSchema.parse(req.body);
      
      // Normalize the URL if it's a full storage URL
      if (validatedData.url) {
        validatedData.url = objectStorageService.normalizeObjectEntityPath(validatedData.url);
      }
      
      const clip = await storage.createVideoClip(validatedData);
      res.status(201).json(clip);
    } catch (error) {
      console.error("Error creating video clip:", error);
      res.status(400).json({ message: "Failed to create video clip" });
    }
  });

  // Update video clip
  app.put("/api/video-clips/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertVideoClipSchema.partial().parse(req.body);
      const clip = await storage.updateVideoClip(id, validatedData);
      if (!clip) {
        return res.status(404).json({ message: "Video clip not found" });
      }
      res.json(clip);
    } catch (error) {
      console.error("Error updating video clip:", error);
      res.status(400).json({ message: "Failed to update video clip" });
    }
  });

  // Delete video clip
  app.delete("/api/video-clips/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteVideoClip(id);
      if (!deleted) {
        return res.status(404).json({ message: "Video clip not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Error deleting video clip:", error);
      res.status(500).json({ message: "Failed to delete video clip" });
    }
  });

  // Chunked video upload - receive individual chunks
  const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: CHUNK_SIZE + 1024 * 1024, // Allow slightly larger than chunk size
      files: 1,
    },
  });

  app.post("/api/video/upload-chunk", chunkUpload.single('chunk'), async (req, res) => {
    try {
      const { chunkIndex, totalChunks, uploadKey } = req.body;
      
      if (!req.file) {
        return res.status(400).json({ message: "No chunk data provided" });
      }
      
      if (!uploadKey || chunkIndex === undefined || !totalChunks) {
        return res.status(400).json({ message: "Missing required parameters" });
      }

      // Validate upload key format (must be video-timestamp-randomstring)
      if (!/^video-\d+-[a-z0-9]+$/.test(uploadKey)) {
        return res.status(400).json({ message: "Invalid upload key format" });
      }

      const chunkIdx = parseInt(chunkIndex);
      const totalChunksNum = parseInt(totalChunks);

      // Validate chunk limits
      if (totalChunksNum > MAX_CHUNKS || chunkIdx >= totalChunksNum || chunkIdx < 0) {
        return res.status(400).json({ message: "Invalid chunk parameters" });
      }

      // Track upload state
      if (!activeUploads.has(uploadKey)) {
        activeUploads.set(uploadKey, {
          startTime: Date.now(),
          totalChunks: totalChunksNum,
          receivedChunks: new Set(),
        });
      }

      const uploadState = activeUploads.get(uploadKey)!;
      
      // Validate total chunks matches
      if (uploadState.totalChunks !== totalChunksNum) {
        return res.status(400).json({ message: "Total chunks mismatch" });
      }

      // Prevent duplicate chunk uploads
      if (uploadState.receivedChunks.has(chunkIdx)) {
        return res.json({ success: true, chunkIndex: chunkIdx, received: req.file.size, duplicate: true });
      }

      const chunkDir = path.join(CHUNK_UPLOAD_DIR, uploadKey);
      if (!fs.existsSync(chunkDir)) {
        fs.mkdirSync(chunkDir, { recursive: true });
      }

      const chunkPath = path.join(chunkDir, `chunk-${chunkIdx.toString().padStart(5, '0')}`);
      fs.writeFileSync(chunkPath, req.file.buffer);
      uploadState.receivedChunks.add(chunkIdx);

      console.log(`Received chunk ${chunkIdx + 1}/${totalChunksNum} for upload ${uploadKey} (${req.file.size} bytes)`);

      res.json({ 
        success: true, 
        chunkIndex: chunkIdx, 
        received: req.file.size,
        chunksReceived: uploadState.receivedChunks.size,
      });
    } catch (error) {
      console.error("Error handling chunk upload:", error);
      res.status(500).json({ message: "Failed to upload chunk" });
    }
  });

  // Chunked video upload - complete and assemble
  app.post("/api/video/complete-upload", async (req, res) => {
    try {
      const { uploadKey, filename, contentType } = req.body;
      
      if (!uploadKey) {
        return res.status(400).json({ message: "Upload key is required" });
      }

      // Validate upload key format
      if (!/^video-\d+-[a-z0-9]+$/.test(uploadKey)) {
        return res.status(400).json({ message: "Invalid upload key format" });
      }

      // Validate content type for video files
      const validVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/avi'];
      const videoContentType = contentType || 'video/mp4';
      if (!validVideoTypes.includes(videoContentType)) {
        return res.status(400).json({ message: "Invalid content type for video" });
      }

      const uploadState = activeUploads.get(uploadKey);
      const chunkDir = path.join(CHUNK_UPLOAD_DIR, uploadKey);
      
      if (!fs.existsSync(chunkDir)) {
        return res.status(404).json({ message: "Upload not found" });
      }

      const chunks = fs.readdirSync(chunkDir)
        .filter(f => f.startsWith('chunk-'))
        .sort();

      if (chunks.length === 0) {
        return res.status(400).json({ message: "No chunks found" });
      }

      // Validate all chunks are present
      if (uploadState && chunks.length !== uploadState.totalChunks) {
        return res.status(400).json({ 
          message: `Missing chunks: expected ${uploadState.totalChunks}, got ${chunks.length}` 
        });
      }

      console.log(`Assembling ${chunks.length} chunks for upload ${uploadKey}`);

      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

      // Assemble file by streaming chunks
      const assembledFilePath = path.join(chunkDir, 'assembled');
      const writeStream = fs.createWriteStream(assembledFilePath);

      for (const chunkFile of chunks) {
        const chunkPath = path.join(chunkDir, chunkFile);
        const chunkData = fs.readFileSync(chunkPath);
        writeStream.write(chunkData);
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Get file size without loading entire file
      const stats = fs.statSync(assembledFilePath);
      console.log(`Assembled file size: ${stats.size} bytes`);

      // Stream file to object storage using fetch with file stream
      const fileStream = fs.createReadStream(assembledFilePath);
      const { Readable } = await import('stream');

      const uploadResponse = await fetch(uploadURL, {
        method: 'PUT',
        body: Readable.toWeb(fileStream) as ReadableStream,
        headers: {
          'Content-Type': videoContentType,
          'Content-Length': String(stats.size),
        },
        // @ts-ignore - duplex is required for streaming body
        duplex: 'half',
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload to object storage: ${uploadResponse.status}`);
      }

      // Clean up
      fs.rmSync(chunkDir, { recursive: true, force: true });
      activeUploads.delete(uploadKey);

      const url = new URL(uploadURL);
      const normalizedUrl = objectStorageService.normalizeObjectEntityPath(url.pathname);

      console.log(`Video upload complete: ${normalizedUrl}`);

      res.json({ 
        success: true, 
        url: normalizedUrl,
        size: stats.size 
      });
    } catch (error) {
      console.error("Error completing video upload:", error);
      res.status(500).json({ message: "Failed to complete upload" });
    }
  });

  // Chunked video upload - abort/cleanup
  app.delete("/api/video/upload/:uploadKey", async (req, res) => {
    try {
      const { uploadKey } = req.params;
      
      // Validate upload key format
      if (!/^video-\d+-[a-z0-9]+$/.test(uploadKey)) {
        return res.status(400).json({ message: "Invalid upload key format" });
      }

      const chunkDir = path.join(CHUNK_UPLOAD_DIR, uploadKey);
      
      if (fs.existsSync(chunkDir)) {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      }
      
      activeUploads.delete(uploadKey);

      res.json({ success: true });
    } catch (error) {
      console.error("Error aborting upload:", error);
      res.status(500).json({ message: "Failed to abort upload" });
    }
  });

  // Get upload status for resume capability
  app.get("/api/video/upload/:uploadKey/status", async (req, res) => {
    try {
      const { uploadKey } = req.params;
      
      // Validate upload key format
      if (!/^video-\d+-[a-z0-9]+$/.test(uploadKey)) {
        return res.status(400).json({ message: "Invalid upload key format" });
      }

      const uploadState = activeUploads.get(uploadKey);
      if (!uploadState) {
        return res.status(404).json({ message: "Upload not found" });
      }

      res.json({
        totalChunks: uploadState.totalChunks,
        receivedChunks: Array.from(uploadState.receivedChunks),
        chunksReceived: uploadState.receivedChunks.size,
      });
    } catch (error) {
      console.error("Error getting upload status:", error);
      res.status(500).json({ message: "Failed to get upload status" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
