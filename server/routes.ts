import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertFieldNoteSchema, insertPhotoSchema } from "@shared/schema";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

export async function registerRoutes(app: Express): Promise<Server> {
  // Get all field notes with optional filters
  app.get("/api/field-notes", async (req, res) => {
    try {
      const { search, tripType, sortOrder } = req.query;
      const fieldNotes = await storage.getFieldNotes({
        search: search as string,
        tripType: tripType as string,
        sortOrder: sortOrder as 'recent' | 'oldest' | 'name',
      });
      res.json(fieldNotes);
    } catch (error) {
      console.error("Error fetching field notes:", error);
      res.status(500).json({ message: "Failed to fetch field notes" });
    }
  });

  // Get specific field note by ID
  app.get("/api/field-notes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const fieldNote = await storage.getFieldNoteById(id);
      if (!fieldNote) {
        return res.status(404).json({ message: "Field note not found" });
      }
      res.json(fieldNote);
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

  // Create new field note
  app.post("/api/field-notes", async (req, res) => {
    try {
      // Convert string date to Date object
      const bodyWithDate = {
        ...req.body,
        date: req.body.date ? new Date(req.body.date) : undefined
      };
      
      const result = insertFieldNoteSchema.safeParse(bodyWithDate);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid field note data",
          errors: result.error.errors 
        });
      }
      
      const fieldNote = await storage.createFieldNote(result.data);
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
      
      // Convert string date to Date object
      const bodyWithDate = {
        ...req.body,
        date: req.body.date ? new Date(req.body.date) : undefined
      };
      
      const result = insertFieldNoteSchema.safeParse(bodyWithDate);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid field note data",
          errors: result.error.errors 
        });
      }
      
      const fieldNote = await storage.updateFieldNote(id, result.data);
      if (!fieldNote) {
        return res.status(404).json({ message: "Field note not found" });
      }
      
      res.json(fieldNote);
    } catch (error) {
      console.error("Error updating field note:", error);
      res.status(500).json({ message: "Failed to update field note" });
    }
  });

  // Object Storage endpoints for photo uploads
  const objectStorageService = new ObjectStorageService();

  // Endpoint to get upload URL for photos
  app.post("/api/photos/upload", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Endpoint to create photo record after upload
  app.post("/api/photos", async (req, res) => {
    try {
      const validatedData = insertPhotoSchema.parse(req.body);
      
      // Normalize the URL if it's a full storage URL
      if (validatedData.url) {
        validatedData.url = objectStorageService.normalizeObjectEntityPath(validatedData.url);
      }
      
      const photo = await storage.createPhoto(validatedData);
      res.status(201).json(photo);
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
      console.error("Error serving photo:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Photo not found" });
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

  const httpServer = createServer(app);
  return httpServer;
}
