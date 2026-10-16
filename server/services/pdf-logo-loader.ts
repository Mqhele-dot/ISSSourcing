import fs from "fs";
import path from "path";
import { uploadsDir } from "../http/upload-config";

/**
 * Load logo bytes for PDF embedding (PNG or JPEG — caller tries embedPng then embedJpg).
 * Supports absolute http(s) URLs and local paths under `uploads/` or `/`-prefixed public paths.
 */
export async function loadLogoBytesForPdf(logoUrl: string | null | undefined): Promise<Uint8Array | undefined> {
  if (!logoUrl?.trim()) return undefined;
  const u = logoUrl.trim();
  try {
    if (u.startsWith("http://") || u.startsWith("https://")) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 10000);
      const r = await fetch(u, { signal: ac.signal }).finally(() => clearTimeout(timer));
      if (!r.ok) return undefined;
      return new Uint8Array(Buffer.from(await r.arrayBuffer()));
    }
    let local: string;
    if (u.startsWith("/uploads/") || u.startsWith("uploads/")) {
      const rel = u.replace(/^\/?uploads\/?/, "");
      local = path.join(uploadsDir, rel);
    } else if (u.startsWith("/")) {
      local = path.join(process.cwd(), "public", u.replace(/^\//, ""));
    } else {
      local = path.join(uploadsDir, u);
    }
    if (fs.existsSync(local) && fs.statSync(local).isFile()) {
      return new Uint8Array(fs.readFileSync(local));
    }
  } catch {
    return undefined;
  }
  return undefined;
}
