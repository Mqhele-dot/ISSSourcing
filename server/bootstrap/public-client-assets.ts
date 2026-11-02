import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Public build artifacts only. Never point this middleware at uploads or source. */
export function resolveBuiltClientPath(moduleUrl = import.meta.url): string {
  const directory = path.dirname(fileURLToPath(moduleUrl));
  const runtimeLayout = directory.toLowerCase().endsWith(path.join("runtime", "server", "bootstrap").toLowerCase());
  const candidates = [
    path.resolve(directory, "public"), // Bundled dist/index.js, independent of cwd.
    path.resolve(directory, "..", "public"),
    ...(runtimeLayout ? [path.resolve(directory, "..", "..", "..", "public")] : []),
    path.resolve(process.cwd(), "dist", "public"),
  ];
  const found = candidates.find(candidate => fs.existsSync(path.join(candidate, "index.html")));
  if (!found) throw new Error("Built client assets are missing. Build the client before starting the packaged application.");
  return found;
}

/** Install after security/request headers, before database-backed sessions. */
export function registerPublicClientAssets(app: Express, directory = resolveBuiltClientPath()): void {
  const router = express.Router();
  const options = { index: false as const, redirect: false, dotfiles: "deny" as const, fallthrough: false };
  router.use("/assets", express.static(path.resolve(directory, "assets"), options));
  // Do not expose the SPA HTML, source files, API routes or uploaded documents.
  const rootFiles = new Set(["/bootstrap-recovery.js", "/bootstrap-recovery.css", "/manifest.webmanifest", "/sw.js"]);
  router.use((req, res, next) => {
    if (!rootFiles.has(req.path)) return next();
    return express.static(directory, options)(req, res, next);
  });
  router.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = [403, 404, 405].includes(error.status ?? 0) ? error.status! : 500;
    res.status(status).type("text/plain").send(status === 404 ? "Application asset not found. Reload the app to get the current version." : "The application asset could not be loaded. Reload or ask your administrator for help.");
  });
  app.use(router);
}
