import type { Express, Request, Response } from "express";
import { and, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { documents } from "@shared/schema";
import { documentUpload } from "../../http/upload-config";
import type { AuthBundle } from "../procurement/types";

/** Document metadata, upload, soft-delete (archive). */
export function registerDocumentRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/documents", ...masterRead, async (req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
      const entityId = typeof req.query.entityId === "string" ? Number(req.query.entityId) : undefined;
      const archived =
        req.query.archived === "include" || req.query.archived === "only"
          ? req.query.archived
          : "exclude";
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
      const offsetRaw = typeof req.query.offset === "string" ? Number(req.query.offset) : NaN;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 100;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;

      const filters = [eq(documents.organizationId, orgId)];
      if (entityType) {
        filters.push(eq(documents.entityType, entityType));
      }
      if (entityId != null && !Number.isNaN(entityId)) {
        filters.push(eq(documents.entityId, entityId));
      }
      if (archived === "exclude") {
        filters.push(isNull(documents.archivedAt));
      } else if (archived === "only") {
        filters.push(isNotNull(documents.archivedAt));
      }
      if (q) {
        const pattern = `%${q}%`;
        filters.push(
          or(
            ilike(documents.fileName, pattern),
            ilike(documents.entityType, pattern),
            ilike(documents.fileUrl, pattern),
          )!,
        );
      }

      const rows = await db
        .select()
        .from(documents)
        .where(and(...filters))
        .orderBy(desc(documents.uploadedAt), desc(documents.id))
        .limit(limit)
        .offset(offset);
      res.json(rows);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/documents", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        entityType: string;
        entityId: number;
        fileUrl: string;
        fileName: string;
        mimeType?: string;
        fileSize?: number;
        checksum?: string;
      };
      if (!payload?.entityType || !payload?.entityId || !payload?.fileUrl || !payload?.fileName) {
        return res.status(400).json({ message: "entityType, entityId, fileUrl and fileName are required" });
      }
      const orgId = getActiveOrganizationId();
      const orgScope = eq(documents.organizationId, orgId);
      const existing = await db
        .select()
        .from(documents)
        .where(
          and(orgScope, eq(documents.entityType, payload.entityType), eq(documents.entityId, payload.entityId)),
        );
      const version = existing.length > 0 ? Math.max(...existing.map((d) => Number(d.version ?? 1))) + 1 : 1;
      const createdRows = (await db
        .insert(documents)
        .values({
          ...payload,
          organizationId: orgId,
          version,
          uploadedBy: (req as Request & { user?: { id: number } }).user?.id,
        } as any)
        .returning()) as any[];
      const created = createdRows[0];
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating document record:", error);
      res.status(500).json({ message: "Failed to create document record" });
    }
  });

  app.post("/api/documents/upload", ...masterWrite, documentUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "File is required" });
      const entityType = typeof req.body?.entityType === "string" ? req.body.entityType : "";
      const entityId = Number(req.body?.entityId);
      if (!entityType || !Number.isFinite(entityId)) {
        return res.status(400).json({ message: "entityType and entityId are required" });
      }

      const fileUrl = `/uploads/documents/${req.file.filename}`;
      const orgId = getActiveOrganizationId();
      const orgScope = eq(documents.organizationId, orgId);
      const existing = await db
        .select()
        .from(documents)
        .where(and(orgScope, eq(documents.entityType, entityType), eq(documents.entityId, entityId)));
      const version = existing.length > 0 ? Math.max(...existing.map((d) => Number(d.version ?? 1))) + 1 : 1;
      const createdRows = (await db
        .insert(documents)
        .values({
          organizationId: orgId,
          entityType,
          entityId,
          fileUrl,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          version,
          uploadedBy: (req as Request & { user?: { id: number } }).user?.id ?? null,
        } as any)
        .returning()) as any[];
      res.status(201).json(createdRows[0]);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete("/api/documents/:id", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid document ID" });
      const orgId = getActiveOrganizationId();
      const updatedRows = (await db
        .update(documents)
        .set({ archivedAt: new Date() } as any)
        .where(and(eq(documents.id, id), eq(documents.organizationId, orgId)))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return res.status(404).json({ message: "Document not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error archiving document:", error);
      res.status(500).json({ message: "Failed to archive document" });
    }
  });
}
