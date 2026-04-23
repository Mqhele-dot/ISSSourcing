import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Replit-only: the runtime error modal can trigger full page reloads in other hosts (e.g. Codespaces). */
const isReplit = process.env.REPL_ID !== undefined;

export default defineConfig({
  /**
   * Cloud-synced worktrees (OneDrive, Dropbox, iCloud) often emit rapid write events; without debouncing,
   * Vite can rebuild/HMR continuously — the browser looks like it is “refreshing” forever.
   */
  server: {
    watch: {
      ignored: ["**/node_modules/**", "**/.git/objects/**"],
      awaitWriteFinish: { stabilityThreshold: 450, pollInterval: 100 },
    },
  },
  plugins: [
    react(),
    ...(isReplit ? [runtimeErrorOverlay()] : []),
    themePlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
