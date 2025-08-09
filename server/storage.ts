import { fieldNotes, photos, type FieldNote, type Photo, type InsertFieldNote, type InsertPhoto } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, like, and } from "drizzle-orm";

export interface IStorage {
  // Field Notes
  getFieldNotes(options?: {
    search?: string;
    tripType?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  }): Promise<FieldNote[]>;
  getFieldNoteById(id: string): Promise<FieldNote | undefined>;
  createFieldNote(fieldNote: InsertFieldNote): Promise<FieldNote>;
  updateFieldNote(id: string, fieldNote: InsertFieldNote): Promise<FieldNote | undefined>;
  deleteFieldNote(id: string): Promise<boolean>;
  
  // Photos
  getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]>;
  getPhotoById(id: string): Promise<Photo | undefined>;
  createPhoto(photo: InsertPhoto): Promise<Photo>;
  deletePhoto(id: string): Promise<boolean>;
  updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]>;
}

export class DatabaseStorage implements IStorage {
  async getFieldNotes(options: {
    search?: string;
    tripType?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  } = {}): Promise<FieldNote[]> {
    let query = db.select().from(fieldNotes);
    
    const conditions = [];
    
    if (options.search) {
      conditions.push(like(fieldNotes.title, `%${options.search}%`));
    }
    
    if (options.tripType) {
      conditions.push(eq(fieldNotes.tripType, options.tripType));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        query = query.orderBy(asc(fieldNotes.date)) as typeof query;
        break;
      case 'name':
        query = query.orderBy(asc(fieldNotes.title)) as typeof query;
        break;
      case 'recent':
      default:
        query = query.orderBy(desc(fieldNotes.date)) as typeof query;
        break;
    }
    
    return await query;
  }

  async getFieldNoteById(id: string): Promise<FieldNote | undefined> {
    const [fieldNote] = await db.select().from(fieldNotes).where(eq(fieldNotes.id, id));
    return fieldNote || undefined;
  }

  async createFieldNote(insertFieldNote: InsertFieldNote): Promise<FieldNote> {
    const [fieldNote] = await db
      .insert(fieldNotes)
      .values(insertFieldNote)
      .returning();
    return fieldNote;
  }

  async updateFieldNote(id: string, updateFieldNote: InsertFieldNote): Promise<FieldNote | undefined> {
    const [fieldNote] = await db
      .update(fieldNotes)
      .set(updateFieldNote)
      .where(eq(fieldNotes.id, id))
      .returning();
    return fieldNote || undefined;
  }

  async deleteFieldNote(id: string): Promise<boolean> {
    // First delete all associated photos
    await db.delete(photos).where(eq(photos.fieldNoteId, id));
    
    // Then delete the field note
    const result = await db.delete(fieldNotes).where(eq(fieldNotes.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]> {
    return await db.select().from(photos).where(eq(photos.fieldNoteId, fieldNoteId));
  }

  async getPhotoById(id: string): Promise<Photo | undefined> {
    const [photo] = await db.select().from(photos).where(eq(photos.id, id));
    return photo || undefined;
  }

  async createPhoto(insertPhoto: InsertPhoto): Promise<Photo> {
    const [photo] = await db
      .insert(photos)
      .values(insertPhoto)
      .returning();
    return photo;
  }

  async deletePhoto(id: string): Promise<boolean> {
    const result = await db.delete(photos).where(eq(photos.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]> {
    // Get existing photos to compare
    const existingPhotos = await this.getPhotosByFieldNoteId(fieldNoteId);
    const existingPhotoIds = new Set(existingPhotos.map(p => p.id));
    
    // Track which photos should remain (either existing ones with ID or new ones)
    const keepPhotoIds = new Set();
    const newPhotos: Photo[] = [];
    
    // Process each photo from the form
    for (const photoData of photosData) {
      if (photoData.id && existingPhotoIds.has(photoData.id)) {
        // This is an existing photo to keep
        keepPhotoIds.add(photoData.id);
      } else if (!photoData.id && photoData.url && photoData.filename) {
        // This is a new photo to create
        const newPhoto = await this.createPhoto({
          fieldNoteId,
          filename: photoData.filename,
          url: photoData.url,
          latitude: photoData.latitude || null,
          longitude: photoData.longitude || null,
          elevation: photoData.elevation || null,
          timestamp: photoData.timestamp || null,
          camera: photoData.camera || null,
          lens: photoData.lens || null,
          aperture: photoData.aperture || null,
          shutterSpeed: photoData.shutterSpeed || null,
          iso: photoData.iso || null,
          focalLength: photoData.focalLength || null,
          fileSize: photoData.fileSize || null,
        });
        newPhotos.push(newPhoto);
      }
    }
    
    // Delete photos that are no longer in the list
    for (const existingPhoto of existingPhotos) {
      if (!keepPhotoIds.has(existingPhoto.id)) {
        await this.deletePhoto(existingPhoto.id);
      }
    }
    
    // Return all current photos for this field note
    return await this.getPhotosByFieldNoteId(fieldNoteId);
  }
}

// Temporary in-memory storage with sample data for demonstration
export class MemStorage implements IStorage {
  async updateFieldNote(id: string, updateFieldNote: InsertFieldNote): Promise<FieldNote | undefined> {
    const index = this.fieldNotesData.findIndex(note => note.id === id);
    if (index === -1) return undefined;
    
    this.fieldNotesData[index] = { ...this.fieldNotesData[index], ...updateFieldNote };
    return this.fieldNotesData[index];
  }

  async deleteFieldNote(id: string): Promise<boolean> {
    const index = this.fieldNotesData.findIndex(note => note.id === id);
    if (index === -1) return false;
    
    // Delete associated photos
    this.photosData = this.photosData.filter(photo => photo.fieldNoteId !== id);
    // Delete field note
    this.fieldNotesData.splice(index, 1);
    return true;
  }
  private fieldNotesData: FieldNote[] = [
    {
      id: "1",
      title: "Mount Whitney Summit Trail",
      description: "A challenging 22-mile round trip hike to the highest peak in the contiguous United States. The trail offers stunning alpine scenery, crystal-clear mountain lakes, and breathtaking views from the summit at 14,505 feet.",
      tripType: "Hiking",
      date: new Date("2024-07-15T06:00:00Z"),
      distance: 22.0,
      elevationGain: 6100,
      gpxData: {
        coordinates: [
          [-118.292, 36.578],
          [-118.291, 36.579],
          [-118.290, 36.580],
          [-118.289, 36.581],
          [-118.288, 36.582]
        ]
      },
      createdAt: new Date("2024-07-16T10:00:00Z")
    },
    {
      id: "2",
      title: "Yosemite Valley Loop",
      description: "A scenic bike ride through the iconic Yosemite Valley, passing by El Capitan, Bridalveil Fall, and Half Dome. Perfect for families and offering incredible photographic opportunities.",
      tripType: "Cycling",
      date: new Date("2024-06-20T08:30:00Z"),
      distance: 12.5,
      elevationGain: 200,
      gpxData: {
        coordinates: [
          [-119.651, 37.748],
          [-119.650, 37.749],
          [-119.649, 37.750],
          [-119.648, 37.751]
        ]
      },
      createdAt: new Date("2024-06-21T09:15:00Z")
    }
  ];

  private photosData: Photo[] = [
    {
      id: "1",
      fieldNoteId: "1",
      filename: "whitney-summit.jpg",
      latitude: 36.578,
      longitude: -118.292,
      altitude: 14505,
      url: "https://example.com/photos/whitney-summit.jpg",
      timestamp: new Date("2024-07-15T14:30:00Z"),
      camera: "Canon EOS R5",
      lens: "RF 24-70mm f/2.8",
      focalLength: "35mm",
      aperture: "f/8",
      shutterSpeed: "1/250",
      iso: 100,
      fileSize: "2.4 MB",
      createdAt: new Date("2024-07-16T10:05:00Z")
    },
    {
      id: "2",
      fieldNoteId: "1",
      filename: "alpine-lake.jpg",
      latitude: 36.580,
      longitude: -118.290,
      altitude: 12000,
      url: "https://example.com/photos/alpine-lake.jpg",
      timestamp: new Date("2024-07-15T11:45:00Z"),
      camera: "Canon EOS R5",
      lens: "RF 16-35mm f/2.8",
      focalLength: "24mm",
      aperture: "f/11",
      shutterSpeed: "1/125",
      iso: 200,
      fileSize: "3.1 MB",
      createdAt: new Date("2024-07-16T10:06:00Z")
    },
    {
      id: "3",
      fieldNoteId: "2",
      filename: "el-capitan.jpg",
      latitude: 37.748,
      longitude: -119.651,
      altitude: 4000,
      url: "https://example.com/photos/el-capitan.jpg",
      timestamp: new Date("2024-06-20T10:15:00Z"),
      camera: "Sony A7IV",
      lens: "24-70mm f/2.8",
      focalLength: "50mm",
      aperture: "f/5.6",
      shutterSpeed: "1/200",
      iso: 100,
      fileSize: "1.8 MB",
      createdAt: new Date("2024-06-21T09:20:00Z")
    }
  ];

  async getFieldNotes(options: {
    search?: string;
    tripType?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  } = {}): Promise<FieldNote[]> {
    let filtered = [...this.fieldNotesData];

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(note => 
        note.title.toLowerCase().includes(searchLower) ||
        note.description.toLowerCase().includes(searchLower)
      );
    }

    if (options.tripType) {
      filtered = filtered.filter(note => note.tripType === options.tripType);
    }

    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        filtered.sort((a, b) => a.date.getTime() - b.date.getTime());
        break;
      case 'name':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        filtered.sort((a, b) => b.date.getTime() - a.date.getTime());
        break;
    }

    return filtered;
  }

  async getFieldNoteById(id: string): Promise<FieldNote | undefined> {
    return this.fieldNotesData.find(note => note.id === id);
  }

  async createFieldNote(insertFieldNote: InsertFieldNote): Promise<FieldNote> {
    const fieldNote: FieldNote = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertFieldNote,
      distance: insertFieldNote.distance ?? null,
      elevationGain: insertFieldNote.elevationGain ?? null,
      createdAt: new Date()
    };
    this.fieldNotesData.push(fieldNote);
    return fieldNote;
  }

  async getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]> {
    return this.photosData.filter(photo => photo.fieldNoteId === fieldNoteId);
  }

  async getPhotoById(id: string): Promise<Photo | undefined> {
    return this.photosData.find(photo => photo.id === id);
  }

  async createPhoto(insertPhoto: InsertPhoto): Promise<Photo> {
    const photo: Photo = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertPhoto,
      latitude: insertPhoto.latitude ?? null,
      longitude: insertPhoto.longitude ?? null,
      elevation: insertPhoto.elevation ?? null,
      timestamp: insertPhoto.timestamp ?? null,
      camera: insertPhoto.camera ?? null,
      lens: insertPhoto.lens ?? null,
      aperture: insertPhoto.aperture ?? null,
      shutterSpeed: insertPhoto.shutterSpeed ?? null,
      iso: insertPhoto.iso ?? null,
      focalLength: insertPhoto.focalLength ?? null,
      fileSize: insertPhoto.fileSize ?? null,
      createdAt: new Date()
    };
    this.photosData.push(photo);
    return photo;
  }

  async deletePhoto(id: string): Promise<boolean> {
    const index = this.photosData.findIndex(photo => photo.id === id);
    if (index !== -1) {
      this.photosData.splice(index, 1);
      return true;
    }
    return false;
  }

  async updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]> {
    // This is a simplified implementation for MemStorage
    // In practice, you'd want the same logic as DatabaseStorage
    return this.photosData.filter(photo => photo.fieldNoteId === fieldNoteId);
  }
}

// Use database storage for permanent data persistence
export const storage = new DatabaseStorage();
