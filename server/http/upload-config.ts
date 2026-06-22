import type { Express } from "express";
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { appEnv } from "../config/env";
import { exportsDirResolution, uploadsDirResolution } from "../lib/deployment-behavior";

export const uploadsDir = uploadsDirResolution();
export const documentsDir = path.join(uploadsDir, "documents");
export const exportsDir = exportsDirResolution();

const DOCUMENT_MIME_ALLOWLIST = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function rejectUnsupportedFile(cb: multer.FileFilterCallback, message: string): void {
  cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", message));
}

function createSafeDiskStorage(targetDir: string) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    },
    filename: (_req, file, cb) => {
      const safeBase = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safeBase}`);
    },
  });
}

/** Multer for custom PDF template upload (stores to uploads/custom-pdf-template.pdf) */
export const pdfTemplateUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (_req, _file, cb) => cb(null, "custom-pdf-template.pdf"),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else rejectUnsupportedFile(cb, "Only PDF files are allowed for the template.");
  },
});

/** Multer for general document uploads under uploads/documents */
export const documentUpload = multer({
  storage: createSafeDiskStorage(documentsDir),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (DOCUMENT_MIME_ALLOWLIST.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    rejectUnsupportedFile(cb, "Unsupported document MIME type.");
  },
});

/** Create on boot so /api/ready uploadPathReady is true before any upload. */
export function ensureUploadDirectories(): void {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
}

/** Mount static file serving for /uploads */
export function mountUploadsStatic(app: Express): void {
  ensureUploadDirectories();
  if (appEnv.isProduction) {
    app.use("/uploads", (_req, res) => {
      res.status(404).json({ message: "Direct upload access is disabled in production." });
    });
    return;
  }
  app.use("/uploads", express.static(uploadsDir));
}
