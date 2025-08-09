import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertFieldNoteSchema } from "@shared/schema";

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

  const httpServer = createServer(app);
  return httpServer;
}
