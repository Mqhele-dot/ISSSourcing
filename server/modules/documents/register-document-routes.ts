import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { db, pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { documents } from "@shared/schema";
import { documentUpload, documentsDir } from "../../http/upload-config";
import type { AuthBundle } from "../procurement/types";

const DOCUMENT_ENTITY_TABLES: Record<string, string> = {
  purchase_order: "purchase_orders",
  requisition: "purchase_requisitions",
  invoice: "invoices",
  supplier: "suppliers",
  warehouse: "warehouses",
  contract: "supplier_contracts",
};

function storedDocumentPath(fileUrl: string): string | null {
  const fileName = path.basename(String(fileUrl ?? ""));
  if (!fileName) return null;
  const root = path.resolve(documentsDir);
  const candidate = path.resolve(root, fileName);
  return path.dirname(candidate) === root ? candidate : null;
}

async function documentEntityExists(organizationId: number, entityType: string, entityId: number): Promise<boolean> {
  const table = DOCUMENT_ENTITY_TABLES[entityType];
  if (!table || !Number.isInteger(entityId) || entityId <= 0) return false;
  const result = await pool.query(`SELECT 1 FROM ${table} WHERE organization_id = $1 AND id = $2 LIMIT 1`, [
    organizationId,
    entityId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

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
      res.json(rows.map((row) => {
        const storedPath = storedDocumentPath(row.fileUrl);
        return { ...row, fileAvailable: Boolean(storedPath && fs.existsSync(storedPath)) };
      }));
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
      if (!(await documentEntityExists(orgId, payload.entityType, Number(payload.entityId)))) {
        return res.status(400).json({ message: "The selected business record does not exist in this organization." });
      }
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
      if (!entityType || !Number.isInteger(entityId) || entityId <= 0) {
        if (req.file?.path) fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({ message: "entityType and entityId are required" });
      }

      const orgId = getActiveOrganizationId();
      if (!(await documentEntityExists(orgId, entityType, entityId))) {
        fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({ message: "The selected business record does not exist in this organization." });
      }
      const fileUrl = `/uploads/documents/${req.file.filename}`;
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

  app.get("/api/documents/:id/download", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid document ID" });
      const [document] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.organizationId, getActiveOrganizationId())))
        .limit(1);
      if (!document) return res.status(404).json({ message: "Document not found" });
      const storedPath = storedDocumentPath(document.fileUrl);
      if (!storedPath || !fs.existsSync(storedPath)) {
        return res.status(410).json({ message: "The stored file is unavailable. Its metadata remains for audit history." });
      }
      return res.download(storedPath, document.fileName);
    } catch (error) {
      console.error("Error downloading document:", error);
      return res.status(500).json({ message: "Failed to download document" });
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
