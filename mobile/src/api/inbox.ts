import { apiJson, apiRequest } from "./client";

export interface GpxStats {
  distance?: number;
  elevationGain?: number;
  date?: string;
  coordinates?: [number, number][];
}

export interface InboxItem {
  id: string;
  userId: string;
  filename: string;
  rawGpx: string;
  gpxStats: GpxStats | null;
  status: "pending" | "promoted" | "dismissed";
  source: string | null;
  stravaId: string | null;
  receivedAt: string;
}

export async function getInboxItems(): Promise<InboxItem[]> {
  return apiJson<InboxItem[]>("/api/inbox");
}

export async function promoteInboxItem(params: {
  id: string;
  title: string;
  description: string;
  tripType: string[];
}): Promise<{ fieldNote: { id: string } }> {
  return apiJson(`/api/inbox/${params.id}/promote`, "POST", {
    title: params.title,
    description: params.description,
    tripType: params.tripType,
  });
}

export async function dismissInboxItem(id: string): Promise<void> {
  const res = await apiRequest(`/api/inbox/${id}`, "DELETE");
  if (!res.ok) throw new Error("Failed to dismiss");
}
