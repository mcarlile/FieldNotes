import { apiJson, apiRequest } from "./client";

export interface FieldNote {
  id: string;
  title: string;
  description: string;
  tripType: string[];
  date: string;
  distance: number | null;
  elevationGain: number | null;
  gpxData: { coordinates?: [number, number][] } | string | null;
  createdAt: string;
  photoCount?: number;
}

export interface Photo {
  id: string;
  fieldNoteId: string;
  filename: string;
  url: string;
  altText: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  timestamp: string | null;
  camera: string | null;
}

export interface FieldNoteDetail extends FieldNote {
  photos: Photo[];
}

export interface ListParams {
  search?: string;
  sortOrder?: "recent" | "oldest" | "name";
}

export async function getFieldNotes(params: ListParams = {}): Promise<FieldNote[]> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.sortOrder) qs.set("sortOrder", params.sortOrder);
  return apiJson<FieldNote[]>(`/api/field-notes?${qs}`);
}

export async function getFieldNote(id: string): Promise<FieldNoteDetail> {
  return apiJson<FieldNoteDetail>(`/api/field-notes/${id}`);
}

export async function deleteFieldNote(id: string): Promise<void> {
  const res = await apiRequest(`/api/field-notes/${id}`, "DELETE");
  if (!res.ok) throw new Error("Failed to delete");
}
