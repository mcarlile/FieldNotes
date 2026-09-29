import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { users } from "@shared/schema";

const missing = { message: "Production record not found" };

function validSecret(value: unknown): boolean {
  const secret = process.env.DESIGN_PREVIEW_SHARED_SECRET;
  if (!secret || secret.length < 32 || typeof value !== "string") return false;
  const received = Buffer.from(value);
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// These are data reads only. Never route an arbitrary path or method to the
// production app, and never include webhook tokens or Strava credentials.
async function readProduction(path: string, query: Record<string, string>, userId: string) {
  if (path === "/api/field-notes") {
    const notes = (await storage.getFieldNotes({
      search: query.search,
      tripType: query.tripType,
      sortOrder: query.sortOrder as "recent" | "oldest" | "name" | undefined,
    })).filter(note => note.userId === userId);
    return Promise.all(notes.map(async note => ({
      ...note,
      photoCount: (await storage.getPhotosByFieldNoteId(note.id)).length,
    })));
  }
  if (path === "/api/expeditions") return storage.getExpeditionsByUser(userId);
  if (path === "/api/inbox") return storage.getInboxItems(userId);

  const noteMatch = /^\/api\/field-notes\/([^/]+)(\/photos)?$/.exec(path);
  if (noteMatch) {
    const note = await storage.getFieldNoteById(noteMatch[1]);
    if (!note || note.userId !== userId) return null;
    const photos = await storage.getPhotosByFieldNoteId(note.id);
    return noteMatch[2] ? photos : { ...note, photos };
  }
  const photoMatch = /^\/api\/photos\/([^/]+)$/.exec(path);
  if (photoMatch) {
    const photo = await storage.getPhotoById(photoMatch[1]);
    if (!photo) return null;
    const note = await storage.getFieldNoteById(photo.fieldNoteId);
    return note?.userId === userId ? photo : null;
  }
  const expeditionMatch = /^\/api\/expeditions\/([^/]+)$/.exec(path);
  if (expeditionMatch) {
    const expedition = await storage.getExpeditionById(expeditionMatch[1]);
    if (!expedition || expedition.userId !== userId) return null;
    const fieldNotes = (await storage.getExpeditionFieldNotes(expedition.id))
      .filter(item => item.fieldNote.userId === userId);
    return { ...expedition, fieldNotes };
  }
  // TrailCam currently has no per-user ownership and is already publicly
  // readable in the app. Keep its previews consistent with those public reads.
  if (path === "/api/trailcam-projects") {
    return storage.getTrailcamProjects({
      search: query.search,
      sortOrder: query.sortOrder as "recent" | "oldest" | "name" | undefined,
    });
  }
  if (path === "/api/video-clips") {
    return query.projectId ? storage.getVideoClipsByProjectId(query.projectId) : null;
  }
  const projectMatch = /^\/api\/trailcam-projects\/([^/]+)$/.exec(path);
  if (projectMatch) return (await storage.getTrailcamProjectById(projectMatch[1])) ?? null;
  const clipMatch = /^\/api\/video-clips\/([^/]+)$/.exec(path);
  if (clipMatch) return (await storage.getVideoClipById(clipMatch[1])) ?? null;
  return undefined;
}

function productionMediaUrls(value: unknown, productionUrl: string): unknown {
  if (Array.isArray(value)) return value.map(item => productionMediaUrls(item, productionUrl));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (typeof child === "string" && /^(\/objects\/|\/public-objects\/)/.test(child) &&
          ["url", "coverPhotoUrl", "thumbnailUrl", "transcodedUrl"].includes(key)) {
        return [key, `${productionUrl}${child}`];
      }
      return [key, productionMediaUrls(child, productionUrl)];
    }));
  }
  return value;
}

export function registerDesignPreview(app: Express) {
  if (process.env.NODE_ENV === "production") {
    app.post("/api/design-preview/read", async (req: Request, res: Response) => {
      if (!validSecret(req.get("x-design-preview-secret"))) return res.sendStatus(404);
      const { userId, path, query } = req.body ?? {};
      if (typeof userId !== "string" || userId.length > 200 ||
          typeof path !== "string" || path.length > 250 ||
          !query || typeof query !== "object" || Array.isArray(query) ||
          !Object.entries(query).every(([key, value]) => key.length <= 40 && typeof value === "string" && value.length <= 500)) {
        return res.sendStatus(400);
      }
      try {
        const [owner] = await db.select({ id: users.id }).from(users)
          .where(eq(users.id, userId)).limit(1);
        if (!owner) return res.status(403).json({ message: "No matching production account" });
        const result = await readProduction(path, query, owner.id);
        if (result === undefined) return res.sendStatus(403);
        if (result === null) return res.status(404).json(missing);
        res.set("Cache-Control", "private, no-store").json(result);
      } catch (error) {
        console.error("Production preview read failed:", error);
        res.status(500).json({ message: "Production preview read failed" });
      }
    });
    return;
  }

  const secret = process.env.DESIGN_PREVIEW_SHARED_SECRET;
  const origin = process.env.DESIGN_PREVIEW_PRODUCTION_URL;
  if (!secret || !origin) return;
  const productionUrl = new URL(origin);
  if (productionUrl.protocol !== "https:" || productionUrl.pathname !== "/" ||
      productionUrl.search || productionUrl.hash) {
    throw new Error("DESIGN_PREVIEW_PRODUCTION_URL must be an HTTPS origin");
  }

  app.get("/api/design-preview/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ readOnly: true });
  });
  app.use("/api", async (req: Request, res: Response, next) => {
    if (req.path === "/design-preview/status" || req.path === "/me" || req.path === "/login") return next();
    if (req.method !== "GET") return res.status(403).json({ message: "Production preview is read-only" });

    try {
      if (req.path.startsWith("/public/")) {
        const response = await fetch(`${productionUrl.origin}${req.originalUrl}`, { signal: AbortSignal.timeout(10000) });
        return res.status(response.status).json(productionMediaUrls(await response.json(), productionUrl.origin));
      }
      const auth = getAuth(req);
      if (!auth.userId) return res.sendStatus(401);
      // The preserved claim is the same local owner ID used by requireAuth;
      // a dev-only Clerk ID or email must never grant access to another owner.
      const userId = (auth.sessionClaims as { userId?: string } | undefined)?.userId ?? auth.userId;
      const path = `/api${req.path}`;
      // Media is already publicly served by production; do not forward
      // the internal preview secret to the browser.
      if (/^\/api\/video-clips\/[^/]+\/(stream|thumbnail)$/.test(path)) {
        return res.redirect(302, `${productionUrl.origin}${path}`);
      }
      const result = await fetch(`${productionUrl.origin}/api/design-preview/read`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-design-preview-secret": secret },
        body: JSON.stringify({
          userId,
          path,
          query: Object.fromEntries(new URLSearchParams(req.originalUrl.split("?")[1] ?? "")),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) {
        const detail = await result.json().catch(() => null);
        if (result.status === 404 && detail?.message === missing.message) {
          return res.status(404).json(missing);
        }
        if (result.status === 403 && detail?.message === "No matching production account") {
          return res.status(403).json({ message: "This sign-in has no matching production account" });
        }
        return res.status(503).json({
          message: "Production preview unavailable. Publish the preview bridge and configure its production secret.",
        });
      }
      res.set("Cache-Control", "private, no-store")
        .json(productionMediaUrls(await result.json(), productionUrl.origin));
    } catch (error) {
      console.error("Design preview request failed:", error);
      res.status(503).json({ message: "Production preview unavailable" });
    }
  });
}