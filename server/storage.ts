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
  
  // Photos
  getPhotosByFieldNoteId(fieldNoteId: string): Promise<Photo[]>;
  getPhotoById(id: string): Promise<Photo | undefined>;
  createPhoto(photo: InsertPhoto): Promise<Photo>;
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
      query = query.where(and(...conditions));
    }
    
    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        query = query.orderBy(asc(fieldNotes.date));
        break;
      case 'name':
        query = query.orderBy(asc(fieldNotes.title));
        break;
      case 'recent':
      default:
        query = query.orderBy(desc(fieldNotes.date));
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
}

// Temporary in-memory storage with sample data for demonstration
export class MemStorage implements IStorage {
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
      caption: "Summit view from Mount Whitney",
      latitude: 36.578,
      longitude: -118.292,
      altitude: 14505,
      dateTaken: new Date("2024-07-15T14:30:00Z"),
      camera: "Canon EOS R5",
      lens: "RF 24-70mm f/2.8",
      focalLength: 35,
      aperture: "f/8",
      shutterSpeed: "1/250",
      iso: 100,
      createdAt: new Date("2024-07-16T10:05:00Z")
    },
    {
      id: "2",
      fieldNoteId: "1",
      filename: "alpine-lake.jpg",
      caption: "Crystal clear alpine lake on the trail",
      latitude: 36.580,
      longitude: -118.290,
      altitude: 12000,
      dateTaken: new Date("2024-07-15T11:45:00Z"),
      camera: "Canon EOS R5",
      lens: "RF 16-35mm f/2.8",
      focalLength: 24,
      aperture: "f/11",
      shutterSpeed: "1/125",
      iso: 200,
      createdAt: new Date("2024-07-16T10:06:00Z")
    },
    {
      id: "3",
      fieldNoteId: "2",
      filename: "el-capitan.jpg",
      caption: "El Capitan from the valley floor",
      latitude: 37.748,
      longitude: -119.651,
      altitude: 4000,
      dateTaken: new Date("2024-06-20T10:15:00Z"),
      camera: "Sony A7IV",
      lens: "24-70mm f/2.8",
      focalLength: 50,
      aperture: "f/5.6",
      shutterSpeed: "1/200",
      iso: 100,
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
      createdAt: new Date()
    };
    this.photosData.push(photo);
    return photo;
  }
}

// Use in-memory storage temporarily until database connection is resolved
export const storage = new MemStorage();
