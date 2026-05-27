import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertFieldNoteSchema, insertPhotoSchema, insertTrailcamProjectSchema, insertVideoClipSchema } from "@shared/schema";
import { ObjectStorageService, ObjectNotFoundError, objectStorageService } from "./objectStorage";
import { extractExifData, extractExifFromBuffer } from "./exif-extractor";
import { startVideoProcessing } from "./videoProcessor";
import { resolveClipCoordinates } from "@shared/gpx-utils";
import { isAuthenticated } from "./replit_integrations/auth";
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';

import * as crypto from 'crypto';
import { getValidStravaToken, stravaFetch, buildGpxFromActivity, importGpxToInbox } from "./strava";

const CHUNK_UPLOAD_DIR = '/tmp/video-chunks';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB
const MAX_CHUNKS = 200; // 200 chunks * 10MB = 2GB max
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour token validity
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP
const MAX_CONCURRENT_UPLOADS_PER_IP = 3;

// Secret for signing upload tokens (in production, use env variable)
const UPLOAD_TOKEN_SECRET = process.env.UPLOAD_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

// Cleanup old uploads periodically
const activeUploads = new Map<string, { 
  startTime: number; 
  totalChunks: number; 
  receivedChunks: Set<number>;
  token: string;
  ip: string;
}>();

// Valid upload tokens
const validTokens = new Map<string, { uploadKey: string; expiresAt: number; ip: string }>();

// Rate limiting by IP
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Concurrent uploads by IP
const uploadsPerIP = new Map<string, Set<string>>();

if (!fs.existsSync(CHUNK_UPLOAD_DIR)) {
  fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
}

// Generate a signed upload token
function generateUploadToken(uploadKey: string, ip: string): string {
  const payload = JSON.stringify({ uploadKey, ip, exp: Date.now() + UPLOAD_TOKEN_TTL_MS });
  const signature = crypto.createHmac('sha256', UPLOAD_TOKEN_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + signature;
}

// Verify and decode an upload token
function verifyUploadToken(token: string, ip: string): { uploadKey: string } | null {
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;
    
    const payload = Buffer.from(payloadB64, 'base64').toString();
    const expectedSignature = crypto.createHmac('sha256', UPLOAD_TOKEN_SECRET).update(payload).digest('hex');
    
    if (signature !== expectedSignature) return null;
    
    const data = JSON.parse(payload);
    if (Date.now() > data.exp) return null;
    if (data.ip !== ip) return null;
    
    return { uploadKey: data.uploadKey };
  } catch {
    return null;
  }
}

// Check rate limit
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Clean up stale uploads on startup and periodically
function cleanupStaleUploads() {
  const now = Date.now();
  const uploadEntries = Array.from(activeUploads.entries());
  for (const [key, data] of uploadEntries) {
    if (now - data.startTime > UPLOAD_TIMEOUT_MS) {
      const chunkDir = path.join(CHUNK_UPLOAD_DIR, key);
      if (fs.existsSync(chunkDir)) {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      }
      
      // Clean up IP tracking
      const ipUploads = uploadsPerIP.get(data.ip);
      if (ipUploads) {
        ipUploads.delete(key);
        if (ipUploads.size === 0) {
          uploadsPerIP.delete(data.ip);
        }
      }
      
      activeUploads.delete(key);
      console.log(`Cleaned up stale upload: ${key}`);
    }
  }
  
  // Clean up expired tokens
  const tokenEntries = Array.from(validTokens.entries());
  for (const [token, data] of tokenEntries) {
    if (now > data.expiresAt) {
      validTokens.delete(token);
    }
  }
}
setInterval(cleanupStaleUploads, 5 * 60 * 1000); // Run every 5 minutes

export async function registerRoutes(app: Express): Promise<Server> {
  // Current user profile — works for both web sessions and mobile Bearer tokens
  app.get("/api/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { pool } = await import("./db");
      const result = await pool.query(
        "SELECT id, email, first_name, last_name, profile_image_url FROM users WHERE id = $1",
        [userId]
      );
      if (!result.rows[0]) return res.status(404).json({ message: "User not found" });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Mobile logout — revokes the Bearer token
  app.delete("/api/auth/mobile-logout", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.deleteMobileTokensByUser(userId);
      res.json({ message: "Logged out" });
    } catch (error) {
      res.status(500).json({ message: "Failed to logout" });
    }
  });

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
    fileFilter: (_req, file, cb) => {
      // Only accept image files
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(null, false);
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
    } catch (error: unknown) {
      console.error("Error extracting EXIF from uploaded photo:", error);
      if (error instanceof Error && error.message === 'EXIF extraction timeout') {
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
  app.post("/api/field-notes", isAuthenticated, async (req, res) => {
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
  app.put("/api/field-notes/:id", isAuthenticated, async (req, res) => {
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
  app.delete("/api/field-notes/:id", isAuthenticated, async (req, res) => {
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
  // Note: objectStorageService is imported from ./objectStorage

  // Endpoint to get upload URL for photos (both POST and PUT for compatibility)
  app.post("/api/photos/upload", isAuthenticated, async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Generic object storage upload endpoint (for videos and other files)
  app.post("/api/objects/upload", isAuthenticated, async (req, res) => {
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
  app.post("/api/photos", isAuthenticated, async (req, res) => {
    try {
      const validatedData = insertPhotoSchema.parse(req.body);
      
      // Normalize the URL if it's a full storage URL
      if (validatedData.url) {
        validatedData.url = objectStorageService.normalizeObjectEntityPath(validatedData.url);
      }
      
      // Verify the uploaded object exists before creating the database record
      // This prevents orphaned DB records when uploads fail
      const objectExists = await objectStorageService.verifyObjectExists(validatedData.url);
      if (!objectExists) {
        console.error(`Upload verification failed: Object not found at ${validatedData.url}`);
        return res.status(400).json({ 
          error: "Upload verification failed", 
          message: "The uploaded file could not be verified. Please try uploading again."
        });
      }
      
      // Create the photo record after verifying the upload
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
        } catch (exifError: unknown) {
          const errorMessage = exifError instanceof Error ? exifError.message : 'Unknown error';
          console.warn(`Background EXIF processing failed for photo ${photo.url}:`, errorMessage);
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
  app.post("/api/trailcam-projects", isAuthenticated, async (req, res) => {
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
  app.put("/api/trailcam-projects/:id", isAuthenticated, async (req, res) => {
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
  app.delete("/api/trailcam-projects/:id", isAuthenticated, async (req, res) => {
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
  app.post("/api/video-clips", isAuthenticated, async (req, res) => {
    try {
      const validatedData = insertVideoClipSchema.parse(req.body);
      
      // Normalize the URL if it's a full storage URL
      if (validatedData.url) {
        validatedData.url = objectStorageService.normalizeObjectEntityPath(validatedData.url);
      }
      
      // Fetch project to get GPX data for coordinate calculation
      const project = await storage.getTrailcamProjectById(validatedData.projectId);
      if (project?.gpxData) {
        const coords = resolveClipCoordinates(
          project.gpxData, 
          validatedData.startTime, 
          validatedData.endTime,
          project.duration || undefined
        );
        console.log(`Calculated clip coordinates: start(${coords.startLatitude}, ${coords.startLongitude}), end(${coords.endLatitude}, ${coords.endLongitude})`);
        
        validatedData.startLatitude = coords.startLatitude;
        validatedData.startLongitude = coords.startLongitude;
        validatedData.endLatitude = coords.endLatitude;
        validatedData.endLongitude = coords.endLongitude;
      }
      
      const clip = await storage.createVideoClip(validatedData);
      res.status(201).json(clip);
      
      // Start async video processing (transcoding + thumbnail generation)
      console.log(`Starting video processing for clip ${clip.id}`);
      startVideoProcessing(clip.id);
    } catch (error) {
      console.error("Error creating video clip:", error);
      res.status(400).json({ message: "Failed to create video clip" });
    }
  });

  // Update video clip
  app.put("/api/video-clips/:id", isAuthenticated, async (req, res) => {
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

  // Recalculate GPS coordinates for a video clip
  app.post("/api/video-clips/:id/recalculate-coordinates", async (req, res) => {
    try {
      const { id } = req.params;
      const clip = await storage.getVideoClipById(id);
      
      if (!clip) {
        return res.status(404).json({ message: "Video clip not found" });
      }
      
      const project = await storage.getTrailcamProjectById(clip.projectId);
      if (!project?.gpxData) {
        return res.status(400).json({ message: "Project has no GPX data" });
      }
      
      const coords = resolveClipCoordinates(
        project.gpxData, 
        clip.startTime, 
        clip.endTime,
        project.duration || undefined
      );
      
      console.log(`Recalculated clip ${id} coordinates: start(${coords.startLatitude}, ${coords.startLongitude}), end(${coords.endLatitude}, ${coords.endLongitude})`);
      
      const updatedClip = await storage.updateVideoClip(id, {
        startLatitude: coords.startLatitude,
        startLongitude: coords.startLongitude,
        endLatitude: coords.endLatitude,
        endLongitude: coords.endLongitude,
      });
      
      res.json(updatedClip);
    } catch (error) {
      console.error("Error recalculating coordinates:", error);
      res.status(500).json({ message: "Failed to recalculate coordinates" });
    }
  });

  // Delete video clip
  app.delete("/api/video-clips/:id", isAuthenticated, async (req, res) => {
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

  // Stream video clip (serves the video for browser playback)
  app.get("/api/video-clips/:id/stream", async (req, res) => {
    try {
      const { id } = req.params;
      const clip = await storage.getVideoClipById(id);
      
      if (!clip) {
        return res.status(404).json({ message: "Video clip not found" });
      }
      
      // Use transcoded version if available, otherwise fall back to original
      const videoUrl = clip.transcodedUrl || clip.url;
      
      const file = await objectStorageService.getFileFromRawPath(videoUrl);
      const [metadata] = await file.getMetadata();
      
      // Handle range requests for seeking
      const range = req.headers.range;
      const fileSize = Number(metadata.size);
      
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
        });
        
        const stream = file.createReadStream({ start, end });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        });
        
        const stream = file.createReadStream();
        stream.pipe(res);
      }
    } catch (error) {
      console.error("Error streaming video:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to stream video" });
      }
    }
  });

  // Stream video thumbnail
  app.get("/api/video-clips/:id/thumbnail", async (req, res) => {
    try {
      const { id } = req.params;
      const clip = await storage.getVideoClipById(id);
      
      if (!clip || !clip.thumbnailUrl) {
        return res.status(404).json({ message: "Thumbnail not found" });
      }
      
      const file = await objectStorageService.getFileFromRawPath(clip.thumbnailUrl);
      await objectStorageService.downloadObject(file, res, 86400); // 24 hour cache
    } catch (error) {
      console.error("Error serving thumbnail:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to serve thumbnail" });
      }
    }
  });

  // Retry video processing (if it failed)
  app.post("/api/video-clips/:id/reprocess", async (req, res) => {
    try {
      const { id } = req.params;
      const clip = await storage.getVideoClipById(id);
      
      if (!clip) {
        return res.status(404).json({ message: "Video clip not found" });
      }
      
      if (clip.processingStatus === 'processing') {
        return res.status(400).json({ message: "Video is already being processed" });
      }
      
      await storage.updateVideoClip(id, { 
        processingStatus: 'pending',
        processingError: null 
      });
      
      startVideoProcessing(id);
      res.json({ message: "Video processing started" });
    } catch (error) {
      console.error("Error reprocessing video:", error);
      res.status(500).json({ message: "Failed to start video processing" });
    }
  });

  // Initialize a chunked video upload and get a signed token
  app.post("/api/video/init-upload", isAuthenticated, async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      
      // Rate limiting
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ message: "Too many requests, please slow down" });
      }
      
      // Check concurrent upload limit
      const currentUploads = uploadsPerIP.get(ip);
      if (currentUploads && currentUploads.size >= MAX_CONCURRENT_UPLOADS_PER_IP) {
        return res.status(429).json({ message: "Maximum concurrent uploads reached" });
      }
      
      // Generate upload key and token
      const uploadKey = `video-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const token = generateUploadToken(uploadKey, ip);
      
      // Track token
      validTokens.set(token, { 
        uploadKey, 
        expiresAt: Date.now() + UPLOAD_TOKEN_TTL_MS,
        ip 
      });
      
      // Track upload per IP
      if (!uploadsPerIP.has(ip)) {
        uploadsPerIP.set(ip, new Set());
      }
      uploadsPerIP.get(ip)!.add(uploadKey);
      
      console.log(`Initialized upload ${uploadKey} for IP ${ip}`);
      
      res.json({ uploadKey, token });
    } catch (error) {
      console.error("Error initializing upload:", error);
      res.status(500).json({ message: "Failed to initialize upload" });
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

  app.post("/api/video/upload-chunk", isAuthenticated, chunkUpload.single('chunk'), async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { chunkIndex, totalChunks, uploadKey, token } = req.body;
      
      // Rate limiting
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ message: "Too many requests" });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: "No chunk data provided" });
      }
      
      if (!uploadKey || chunkIndex === undefined || !totalChunks || !token) {
        return res.status(400).json({ message: "Missing required parameters" });
      }

      // Verify token
      const tokenData = verifyUploadToken(token, ip);
      if (!tokenData || tokenData.uploadKey !== uploadKey) {
        return res.status(401).json({ message: "Invalid or expired upload token" });
      }

      // Validate upload key format (must be video-timestamp-randomhex)
      if (!/^video-\d+-[a-f0-9]+$/.test(uploadKey)) {
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
          token,
          ip,
        });
      }

      const uploadState = activeUploads.get(uploadKey)!;
      
      // Verify token matches the one used to initialize
      if (uploadState.token && uploadState.token !== token) {
        return res.status(401).json({ message: "Token mismatch" });
      }
      
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
  app.post("/api/video/complete-upload", isAuthenticated, async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { uploadKey, filename, contentType, token } = req.body;
      
      if (!uploadKey || !token) {
        return res.status(400).json({ message: "Upload key and token are required" });
      }

      // Verify token
      const tokenData = verifyUploadToken(token, ip);
      if (!tokenData || tokenData.uploadKey !== uploadKey) {
        return res.status(401).json({ message: "Invalid or expired upload token" });
      }

      // Validate upload key format
      if (!/^video-\d+-[a-f0-9]+$/.test(uploadKey)) {
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
      
      // Clean up IP tracking and token (uploadState was already retrieved above)
      if (uploadState) {
        const ipUploads = uploadsPerIP.get(uploadState.ip);
        if (ipUploads) {
          ipUploads.delete(uploadKey);
          if (ipUploads.size === 0) {
            uploadsPerIP.delete(uploadState.ip);
          }
        }
        // Invalidate the token
        validTokens.delete(token);
      }
      
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
      if (!/^video-\d+-[a-f0-9]+$/.test(uploadKey)) {
        return res.status(400).json({ message: "Invalid upload key format" });
      }

      const chunkDir = path.join(CHUNK_UPLOAD_DIR, uploadKey);
      const uploadState = activeUploads.get(uploadKey);
      
      if (fs.existsSync(chunkDir)) {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      }
      
      // Clean up IP tracking and invalidate token
      if (uploadState) {
        const ipUploads = uploadsPerIP.get(uploadState.ip);
        if (ipUploads) {
          ipUploads.delete(uploadKey);
          if (ipUploads.size === 0) {
            uploadsPerIP.delete(uploadState.ip);
          }
        }
        // Invalidate the token
        validTokens.delete(uploadState.token);
      }
      
      activeUploads.delete(uploadKey);

      res.json({ success: true });
    } catch (error) {
      console.error("Error aborting upload:", error);
      res.status(500).json({ message: "Failed to abort upload" });
    }
  });

  // Get upload status for resume capability
  app.post("/api/video/upload/:uploadKey/status", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { uploadKey } = req.params;
      const { token } = req.body;
      
      // Validate upload key format
      if (!/^video-\d+-[a-f0-9]+$/.test(uploadKey)) {
        return res.status(400).json({ message: "Invalid upload key format" });
      }
      
      // Verify token
      if (!token) {
        return res.status(401).json({ message: "Token required" });
      }
      const tokenData = verifyUploadToken(token, ip);
      if (!tokenData || tokenData.uploadKey !== uploadKey) {
        return res.status(401).json({ message: "Invalid or expired upload token" });
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

  // ── GPX Inbox & Webhook ──────────────────────────────────────────────────

  // Get or create the user's webhook token
  app.get("/api/inbox/token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let tokenRow = await storage.getWebhookTokenByUserId(userId);
      if (!tokenRow) {
        const token = crypto.randomBytes(24).toString('hex');
        tokenRow = await storage.upsertWebhookToken(userId, token);
      }
      res.json({ token: tokenRow.token });
    } catch (error) {
      console.error("Error getting webhook token:", error);
      res.status(500).json({ message: "Failed to get webhook token" });
    }
  });

  // Regenerate the user's webhook token
  app.post("/api/inbox/token/regenerate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const token = crypto.randomBytes(24).toString('hex');
      const tokenRow = await storage.upsertWebhookToken(userId, token);
      res.json({ token: tokenRow.token });
    } catch (error) {
      console.error("Error regenerating webhook token:", error);
      res.status(500).json({ message: "Failed to regenerate webhook token" });
    }
  });

  // Get all inbox items for the authenticated user
  app.get("/api/inbox", isAuthenticated, async (req: any, res) => {
    try {
      const items = await storage.getInboxItems(req.user.claims.sub);
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox:", error);
      res.status(500).json({ message: "Failed to fetch inbox" });
    }
  });

  // Delete an inbox item
  app.delete("/api/inbox/:id", isAuthenticated, async (req: any, res) => {
    try {
      const item = await storage.getInboxItemById(req.params.id);
      if (!item || item.userId !== req.user.claims.sub) {
        return res.status(404).json({ message: "Item not found" });
      }
      await storage.deleteInboxItem(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting inbox item:", error);
      res.status(500).json({ message: "Failed to delete inbox item" });
    }
  });

  // Promote an inbox item to a field note
  app.post("/api/inbox/:id/promote", isAuthenticated, async (req: any, res) => {
    try {
      const item = await storage.getInboxItemById(req.params.id);
      if (!item || item.userId !== req.user.claims.sub) {
        return res.status(404).json({ message: "Item not found" });
      }
      const stats = item.gpxStats as any;
      const fieldNote = await storage.createFieldNote({
        title: req.body.title || item.filename.replace(/\.gpx$/i, ''),
        description: req.body.description || '',
        tripType: Array.isArray(req.body.tripType) ? req.body.tripType : (req.body.tripType ? [req.body.tripType] : ['hiking']),
        date: stats?.date ? new Date(stats.date) : new Date(item.receivedAt),
        distance: stats?.distance ?? null,
        elevationGain: stats?.elevationGain ?? null,
        gpxData: stats?.coordinates ? { coordinates: stats.coordinates } : null,
      });
      await storage.updateInboxItemStatus(item.id, 'promoted');
      res.json({ fieldNote });
    } catch (error) {
      console.error("Error promoting inbox item:", error);
      res.status(500).json({ message: "Failed to promote inbox item" });
    }
  });

  // PUBLIC webhook endpoint — accepts GPX via multipart or raw body
  const gpxWebhookMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  app.post("/api/webhook/gpx/:token", gpxWebhookMulter.single('file'), async (req, res) => {
    try {
      const { token } = req.params;
      const tokenRow = await storage.getWebhookTokenByToken(token);
      if (!tokenRow) {
        return res.status(401).json({ message: "Invalid webhook token" });
      }

      let rawGpx: string;
      let filename: string;

      if (req.file) {
        // multipart upload
        rawGpx = req.file.buffer.toString('utf-8');
        filename = req.file.originalname || 'track.gpx';
      } else if (req.body && typeof req.body === 'string' && req.body.length > 0) {
        rawGpx = req.body;
        filename = (req.headers['x-filename'] as string) || 'track.gpx';
      } else if (req.body && req.body.gpx) {
        rawGpx = req.body.gpx;
        filename = req.body.filename || 'track.gpx';
      } else {
        return res.status(400).json({ message: "No GPX data found. Send as multipart file field 'file', raw body, or JSON {gpx, filename}" });
      }

      if (!rawGpx.includes('<gpx') && !rawGpx.includes('<trk')) {
        return res.status(400).json({ message: "Content does not appear to be valid GPX" });
      }

      // Parse basic stats from the GPX
      let gpxStats: any = null;
      try {
        const { parseGpxData } = await import('@shared/gpx-utils');
        gpxStats = parseGpxData(rawGpx);
      } catch (_) { /* stats are optional */ }

      const sourceIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
      const item = await storage.createInboxItem({
        userId: tokenRow.userId,
        filename,
        rawGpx,
        gpxStats,
        sourceIp,
      });

      res.status(201).json({ id: item.id, filename: item.filename, receivedAt: item.receivedAt });
    } catch (error) {
      console.error("Webhook GPX error:", error);
      res.status(500).json({ message: "Failed to process GPX" });
    }
  });

  // ── Strava OAuth & Import ─────────────────────────────────────────────────

  // Step 1: Redirect user to Strava consent page using app-level credentials
  app.get("/api/strava/auth", isAuthenticated, async (req: any, res) => {
    const clientId = process.env.STRAVA_CLIENT_ID;
    if (!clientId) {
      return res.redirect("/inbox?strava=error");
    }

    const stateNonce = crypto.randomBytes(24).toString("hex");
    (req.session as any).stravaOAuthState = stateNonce;

    const redirectUri = `https://${req.hostname}/api/strava/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read,activity:read_all",
      approval_prompt: "auto",
      state: stateNonce,
    });
    res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
  });

  // Step 2: Handle OAuth callback using app-level credentials
  app.get("/api/strava/callback", isAuthenticated, async (req: any, res) => {
    const { code, error, scope, state } = req.query as Record<string, string>;

    if (error || !code) {
      return res.redirect("/inbox?strava=denied");
    }

    const expectedState = (req.session as any).stravaOAuthState;
    (req.session as any).stravaOAuthState = undefined;
    if (!expectedState || !state || expectedState !== state) {
      console.warn("Strava OAuth state mismatch");
      return res.redirect("/inbox?strava=error");
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect("/inbox?strava=error");
    }

    try {
      const userId = req.user.claims.sub;
      const redirectUri = `https://${req.hostname}/api/strava/callback`;
      const tokenResp = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResp.ok) {
        console.error("Strava token exchange failed:", await tokenResp.text());
        return res.redirect("/inbox?strava=error");
      }

      const tokenData = await tokenResp.json() as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
        athlete: { id: number };
      };

      await storage.upsertStravaConnection({
        userId,
        stravaAthleteId: tokenData.athlete.id,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at,
        scope: scope ?? null,
      });

      res.redirect("/inbox?strava=connected");
    } catch (err) {
      console.error("Strava callback error:", err);
      res.redirect("/inbox?strava=error");
    }
  });

  // Connection status
  app.get("/api/strava/status", isAuthenticated, async (req: any, res) => {
    try {
      const appConfigured = !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
      const conn = await storage.getStravaConnection(req.user.claims.sub);
      if (!appConfigured) {
        return res.json({ state: "not_configured", connected: false });
      }
      if (!conn?.accessToken || !conn.stravaAthleteId) {
        return res.json({ state: "disconnected", connected: false });
      }
      res.json({
        state: "connected",
        connected: true,
        stravaAthleteId: conn.stravaAthleteId,
        connectedAt: conn.connectedAt,
      });
    } catch (err) {
      console.error("Strava status error:", err);
      res.status(500).json({ message: "Failed to get Strava status" });
    }
  });

  // Get the OAuth redirect URI the user must whitelist in their Strava app
  app.get("/api/strava/redirect-uri", isAuthenticated, (req: any, res) => {
    res.json({ redirectUri: `https://${req.hostname}/api/strava/callback`, domain: req.hostname });
  });

  // Disconnect
  app.delete("/api/strava/disconnect", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteStravaConnection(req.user.claims.sub);
      res.json({ success: true });
    } catch (err) {
      console.error("Strava disconnect error:", err);
      res.status(500).json({ message: "Failed to disconnect Strava" });
    }
  });

  // List recent activities from Strava (proxied, not stored)
  app.get("/api/strava/activities", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const perPage = 30;
      const resp = await stravaFetch(userId, `/athlete/activities?per_page=${perPage}`);
      if (!resp.ok) {
        const body = await resp.text();
        console.error("Strava activities fetch failed:", body);
        return res.status(resp.status).json({ message: "Failed to fetch Strava activities" });
      }
      const activities = await resp.json();
      res.json(activities);
    } catch (err: any) {
      if (err.message?.includes("not connected")) return res.status(401).json({ message: "Strava not connected" });
      console.error("Strava activities error:", err);
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // List routes from Strava (proxied, not stored)
  app.get("/api/strava/routes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const conn = await storage.getStravaConnection(userId);
      if (!conn) return res.status(401).json({ message: "Strava not connected" });

      const resp = await stravaFetch(userId, `/athlete/routes?per_page=30`);
      if (!resp.ok) {
        const body = await resp.text();
        console.error("Strava routes fetch failed:", body);
        return res.status(resp.status).json({ message: "Failed to fetch Strava routes" });
      }
      const routes = await resp.json();
      res.json(routes);
    } catch (err: any) {
      if (err.message?.includes("not connected")) return res.status(401).json({ message: "Strava not connected" });
      console.error("Strava routes error:", err);
      res.status(500).json({ message: "Failed to fetch routes" });
    }
  });

  // Import a Strava activity into the inbox
  app.post("/api/strava/import/activity/:stravaId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { stravaId } = req.params;

      // Dedup check (scoped to source so activity/route IDs don't collide)
      const existing = await storage.getInboxItemByStravaId(userId, "strava-activity", stravaId);
      if (existing) {
        return res.status(409).json({ message: "Already in your inbox", inboxItemId: existing.id });
      }

      // Fetch activity metadata
      const activityResp = await stravaFetch(userId, `/activities/${stravaId}`);
      if (!activityResp.ok) {
        return res.status(activityResp.status).json({ message: "Activity not found on Strava" });
      }
      const activity = await activityResp.json() as {
        id: number; name: string; start_date: string; sport_type: string;
      };

      // Fetch GPS streams
      const streamsResp = await stravaFetch(
        userId,
        `/activities/${stravaId}/streams?keys=latlng,altitude,time&key_by_type=true`
      );
      if (!streamsResp.ok) {
        return res.status(streamsResp.status).json({ message: "Failed to fetch activity streams" });
      }
      const streams = await streamsResp.json();

      if (!streams.latlng?.data?.length) {
        return res.status(422).json({ message: "Activity has no GPS data" });
      }

      const rawGpx = buildGpxFromActivity(activity, streams);
      const safeName = activity.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
      const filename = `strava_activity_${safeName}_${stravaId}.gpx`;

      const inboxItem = await importGpxToInbox({ userId, rawGpx, filename, source: "strava-activity", stravaId });
      res.status(201).json(inboxItem);
    } catch (err: any) {
      if (err.message?.includes("not connected")) return res.status(401).json({ message: "Strava not connected" });
      console.error("Strava activity import error:", err);
      res.status(500).json({ message: "Failed to import activity" });
    }
  });

  // Import a Strava route into the inbox
  app.post("/api/strava/import/route/:stravaId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { stravaId } = req.params;

      // Dedup check (scoped to source so activity/route IDs don't collide)
      const existing = await storage.getInboxItemByStravaId(userId, "strava-route", stravaId);
      if (existing) {
        return res.status(409).json({ message: "Already in your inbox", inboxItemId: existing.id });
      }

      // Fetch route metadata for the filename
      const routeMetaResp = await stravaFetch(userId, `/routes/${stravaId}`);
      if (!routeMetaResp.ok) {
        return res.status(routeMetaResp.status).json({ message: "Route not found on Strava" });
      }
      const routeMeta = await routeMetaResp.json() as { id: number; name: string };

      // Fetch the GPX export directly from Strava
      const gpxResp = await stravaFetch(userId, `/routes/${stravaId}/export_gpx`);
      if (!gpxResp.ok) {
        return res.status(gpxResp.status).json({ message: "Failed to export route GPX from Strava" });
      }
      const rawGpx = await gpxResp.text();

      const safeName = routeMeta.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
      const filename = `strava_route_${safeName}_${stravaId}.gpx`;

      const inboxItem = await importGpxToInbox({ userId, rawGpx, filename, source: "strava-route", stravaId });
      res.status(201).json(inboxItem);
    } catch (err: any) {
      if (err.message?.includes("not connected")) return res.status(401).json({ message: "Strava not connected" });
      console.error("Strava route import error:", err);
      res.status(500).json({ message: "Failed to import route" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
