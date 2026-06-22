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
const isManagedCodexWorktree = __dirname.includes(`${path.sep}.codex${path.sep}worktrees${path.sep}`);

export default defineConfig({
  /**
   * Cloud-synced worktrees often emit rapid write events; without debouncing,
   * Vite can rebuild/HMR continuously and make the browser look like it is refreshing forever.
   */
  server: {
    fs: {
      allow: [__dirname],
    },
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
  optimizeDeps: isManagedCodexWorktree
    ? {
        noDiscovery: true,
        exclude: ["date-fns", "date-fns/locale", "react-day-picker"],
      }
    : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
      ...(isManagedCodexWorktree
        ? {
            "date-fns": path.resolve(__dirname, "node_modules", "date-fns", "index.mjs"),
            "date-fns/locale": path.resolve(__dirname, "node_modules", "date-fns", "locale.mjs"),
            react: path.resolve(__dirname, "node_modules", "react", "cjs", "react.development.js"),
            "react/jsx-runtime": path.resolve(
              __dirname,
              "node_modules",
              "react",
              "cjs",
              "react-jsx-runtime.development.js",
            ),
            "react/jsx-dev-runtime": path.resolve(
              __dirname,
              "node_modules",
              "react",
              "cjs",
              "react-jsx-dev-runtime.development.js",
            ),
            "react-dom": path.resolve(__dirname, "node_modules", "react-dom", "cjs", "react-dom.development.js"),
            scheduler: path.resolve(
              __dirname,
              "node_modules",
              "scheduler",
              "cjs",
              "scheduler.development.js",
            ),
            "react-day-picker": path.resolve(
              __dirname,
              "node_modules",
              "react-day-picker",
              "dist",
              "index.esm.js",
            ),
          }
        : {}),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
