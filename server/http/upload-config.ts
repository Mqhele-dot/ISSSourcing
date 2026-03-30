import type { Express } from "express";
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

export const uploadsDir = path.join(process.cwd(), "uploads");
export const documentsDir = path.join(uploadsDir, "documents");

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
    else cb(new Error("Only PDF files are allowed for the template."));
  },
});

/** Multer for general document uploads under uploads/documents */
export const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
      cb(null, documentsDir);
    },
    filename: (_req, file, cb) => {
      const safeBase = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safeBase}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** Create on boot so /api/ready uploadPathReady is true before any upload. */
export function ensureUploadDirectories(): void {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
}

/** Mount static file serving for /uploads */
export function mountUploadsStatic(app: Express): void {
  ensureUploadDirectories();
  app.use("/uploads", express.static(uploadsDir));
}
