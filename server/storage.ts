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

export const storage = new DatabaseStorage();
