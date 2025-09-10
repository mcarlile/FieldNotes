import { fieldNotes, photos, trailcamProjects, videoClips, type FieldNote, type Photo, type InsertFieldNote, type InsertPhoto, type TrailcamProject, type VideoClip, type InsertTrailcamProject, type InsertVideoClip } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, like, ilike, and, or } from "drizzle-orm";

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
  updatePhoto(id: string, photo: Partial<InsertPhoto>): Promise<Photo | undefined>;
  deletePhoto(id: string): Promise<boolean>;
  updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]>;
  
  // TrailCam Projects
  getTrailcamProjects(options?: {
    search?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  }): Promise<TrailcamProject[]>;
  getTrailcamProjectById(id: string): Promise<TrailcamProject | undefined>;
  createTrailcamProject(project: InsertTrailcamProject): Promise<TrailcamProject>;
  updateTrailcamProject(id: string, project: Partial<InsertTrailcamProject>): Promise<TrailcamProject | undefined>;
  deleteTrailcamProject(id: string): Promise<boolean>;
  
  // Video Clips
  getVideoClipsByProjectId(projectId: string): Promise<VideoClip[]>;
  getVideoClipById(id: string): Promise<VideoClip | undefined>;
  createVideoClip(clip: InsertVideoClip): Promise<VideoClip>;
  updateVideoClip(id: string, clip: Partial<InsertVideoClip>): Promise<VideoClip | undefined>;
  deleteVideoClip(id: string): Promise<boolean>;
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
      const searchTerm = options.search.trim();
      if (searchTerm) {
        conditions.push(
          or(
            ilike(fieldNotes.title, `%${searchTerm}%`),
            ilike(fieldNotes.description, `%${searchTerm}%`),
            ilike(fieldNotes.tripType, `%${searchTerm}%`)
          )
        );
      }
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

  async updatePhoto(id: string, updatePhoto: Partial<InsertPhoto>): Promise<Photo | undefined> {
    const [photo] = await db
      .update(photos)
      .set(updatePhoto)
      .where(eq(photos.id, id))
      .returning();
    return photo || undefined;
  }

  async deletePhoto(id: string): Promise<boolean> {
    const result = await db.delete(photos).where(eq(photos.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateFieldNotePhotos(fieldNoteId: string, photosData: any[]): Promise<Photo[]> {
    console.log('Updating field note photos:', fieldNoteId, photosData);
    
    // Get existing photos to compare
    const existingPhotos = await this.getPhotosByFieldNoteId(fieldNoteId);
    const existingPhotoIds = new Set(existingPhotos.map(p => p.id));
    
    // Track which photos should remain (either existing ones with ID or new ones)
    const keepPhotoIds = new Set();
    const newPhotos: Photo[] = [];
    
    // Process each photo from the form
    for (const photoData of photosData) {
      console.log('Processing photo:', photoData);
      
      if (photoData.id && existingPhotoIds.has(photoData.id)) {
        // This is an existing photo to keep
        keepPhotoIds.add(photoData.id);
      } else if (!photoData.id && photoData.url && photoData.filename) {
        // This is a new photo to create
        const newPhoto = await this.createPhoto({
          fieldNoteId,
          filename: photoData.filename,
          url: photoData.url,
          altText: photoData.caption || '',
          latitude: photoData.latitude || null,
          longitude: photoData.longitude || null,
          elevation: photoData.elevation || null,
          timestamp: photoData.timestamp ? new Date(photoData.timestamp) : null,
          camera: photoData.camera || null,
          lens: photoData.lens || null,
          aperture: photoData.aperture || null,
          shutterSpeed: photoData.shutterSpeed || null,
          iso: photoData.iso || null,
          focalLength: photoData.focalLength || null,
          fileSize: photoData.fileSize || null,
        });
        console.log('Created new photo:', newPhoto);
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

  // TrailCam Projects
  async getTrailcamProjects(options: {
    search?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  } = {}): Promise<TrailcamProject[]> {
    let query = db.select().from(trailcamProjects);
    
    const conditions = [];
    
    if (options.search) {
      const searchTerm = options.search.trim();
      if (searchTerm) {
        conditions.push(
          or(
            ilike(trailcamProjects.title, `%${searchTerm}%`),
            ilike(trailcamProjects.description, `%${searchTerm}%`)
          )
        );
      }
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        query = query.orderBy(asc(trailcamProjects.createdAt)) as typeof query;
        break;
      case 'name':
        query = query.orderBy(asc(trailcamProjects.title)) as typeof query;
        break;
      case 'recent':
      default:
        query = query.orderBy(desc(trailcamProjects.createdAt)) as typeof query;
        break;
    }
    
    return await query;
  }

  async getTrailcamProjectById(id: string): Promise<TrailcamProject | undefined> {
    const [project] = await db.select().from(trailcamProjects).where(eq(trailcamProjects.id, id));
    return project || undefined;
  }

  async createTrailcamProject(insertProject: InsertTrailcamProject): Promise<TrailcamProject> {
    const [project] = await db
      .insert(trailcamProjects)
      .values(insertProject)
      .returning();
    return project;
  }

  async updateTrailcamProject(id: string, updateProject: Partial<InsertTrailcamProject>): Promise<TrailcamProject | undefined> {
    const [project] = await db
      .update(trailcamProjects)
      .set(updateProject)
      .where(eq(trailcamProjects.id, id))
      .returning();
    return project || undefined;
  }

  async deleteTrailcamProject(id: string): Promise<boolean> {
    // First delete all associated video clips
    await db.delete(videoClips).where(eq(videoClips.projectId, id));
    
    // Then delete the project
    const result = await db.delete(trailcamProjects).where(eq(trailcamProjects.id, id));
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Video Clips
  async getVideoClipsByProjectId(projectId: string): Promise<VideoClip[]> {
    return await db.select().from(videoClips).where(eq(videoClips.projectId, projectId)).orderBy(asc(videoClips.startTime));
  }

  async getVideoClipById(id: string): Promise<VideoClip | undefined> {
    const [clip] = await db.select().from(videoClips).where(eq(videoClips.id, id));
    return clip || undefined;
  }

  async createVideoClip(insertClip: InsertVideoClip): Promise<VideoClip> {
    const [clip] = await db
      .insert(videoClips)
      .values(insertClip)
      .returning();
    return clip;
  }

  async updateVideoClip(id: string, updateClip: Partial<InsertVideoClip>): Promise<VideoClip | undefined> {
    const [clip] = await db
      .update(videoClips)
      .set(updateClip)
      .where(eq(videoClips.id, id))
      .returning();
    return clip || undefined;
  }

  async deleteVideoClip(id: string): Promise<boolean> {
    const result = await db.delete(videoClips).where(eq(videoClips.id, id));
    return result.rowCount !== null && result.rowCount > 0;
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

  async updatePhoto(id: string, updatePhoto: Partial<InsertPhoto>): Promise<Photo | undefined> {
    const index = this.photosData.findIndex(photo => photo.id === id);
    if (index === -1) return undefined;
    
    this.photosData[index] = { ...this.photosData[index], ...updatePhoto };
    return this.photosData[index];
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
      altText: "",
      latitude: 36.578,
      longitude: -118.292,
      elevation: 14505,
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
      altText: "",
      latitude: 36.580,
      longitude: -118.290,
      elevation: 12000,
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
      altText: "",
      latitude: 37.748,
      longitude: -119.651,
      elevation: 4000,
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
      const searchLower = options.search.toLowerCase().trim();
      if (searchLower) {
        filtered = filtered.filter(note => 
          note.title.toLowerCase().includes(searchLower) ||
          note.description.toLowerCase().includes(searchLower) ||
          note.tripType.toLowerCase().includes(searchLower)
        );
      }
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
      gpxData: insertFieldNote.gpxData ?? null,
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
      altText: insertPhoto.altText ?? null,
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

  // TrailCam Projects - stub implementations for MemStorage
  private trailcamProjectsData: TrailcamProject[] = [];
  private videoClipsData: VideoClip[] = [];

  async getTrailcamProjects(options: {
    search?: string;
    sortOrder?: 'recent' | 'oldest' | 'name';
  } = {}): Promise<TrailcamProject[]> {
    let filtered = [...this.trailcamProjectsData];

    if (options.search) {
      const searchLower = options.search.toLowerCase().trim();
      if (searchLower) {
        filtered = filtered.filter(project => 
          project.title.toLowerCase().includes(searchLower) ||
          (project.description && project.description.toLowerCase().includes(searchLower))
        );
      }
    }

    // Apply sorting
    switch (options.sortOrder) {
      case 'oldest':
        filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        break;
      case 'name':
        filtered.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;
    }

    return filtered;
  }

  async getTrailcamProjectById(id: string): Promise<TrailcamProject | undefined> {
    return this.trailcamProjectsData.find(project => project.id === id);
  }

  async createTrailcamProject(insertProject: InsertTrailcamProject): Promise<TrailcamProject> {
    const project: TrailcamProject = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertProject,
      description: insertProject.description ?? null,
      duration: insertProject.duration ?? null,
      startTime: insertProject.startTime ?? null,
      endTime: insertProject.endTime ?? null,
      createdAt: new Date()
    };
    this.trailcamProjectsData.push(project);
    return project;
  }

  async updateTrailcamProject(id: string, updateProject: Partial<InsertTrailcamProject>): Promise<TrailcamProject | undefined> {
    const index = this.trailcamProjectsData.findIndex(project => project.id === id);
    if (index === -1) return undefined;
    
    this.trailcamProjectsData[index] = { ...this.trailcamProjectsData[index], ...updateProject };
    return this.trailcamProjectsData[index];
  }

  async deleteTrailcamProject(id: string): Promise<boolean> {
    const index = this.trailcamProjectsData.findIndex(project => project.id === id);
    if (index === -1) return false;
    
    // Delete associated video clips
    this.videoClipsData = this.videoClipsData.filter(clip => clip.projectId !== id);
    // Delete project
    this.trailcamProjectsData.splice(index, 1);
    return true;
  }

  // Video Clips
  async getVideoClipsByProjectId(projectId: string): Promise<VideoClip[]> {
    return this.videoClipsData
      .filter(clip => clip.projectId === projectId)
      .sort((a, b) => a.startTime - b.startTime);
  }

  async getVideoClipById(id: string): Promise<VideoClip | undefined> {
    return this.videoClipsData.find(clip => clip.id === id);
  }

  async createVideoClip(insertClip: InsertVideoClip): Promise<VideoClip> {
    const clip: VideoClip = {
      id: Math.random().toString(36).substr(2, 9),
      ...insertClip,
      fileSize: insertClip.fileSize ?? null,
      videoFormat: insertClip.videoFormat ?? null,
      createdAt: new Date()
    };
    this.videoClipsData.push(clip);
    return clip;
  }

  async updateVideoClip(id: string, updateClip: Partial<InsertVideoClip>): Promise<VideoClip | undefined> {
    const index = this.videoClipsData.findIndex(clip => clip.id === id);
    if (index === -1) return undefined;
    
    this.videoClipsData[index] = { ...this.videoClipsData[index], ...updateClip };
    return this.videoClipsData[index];
  }

  async deleteVideoClip(id: string): Promise<boolean> {
    const index = this.videoClipsData.findIndex(clip => clip.id === id);
    if (index !== -1) {
      this.videoClipsData.splice(index, 1);
      return true;
    }
    return false;
  }
}

// Use database storage for permanent data persistence
export const storage = new DatabaseStorage();
