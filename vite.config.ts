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
const vendorChunks = {
  output: {
    codeSplitting: {
      groups: [
        {
          name: "vendor-react",
          test: /node_modules[\\/](react|react-dom|scheduler|wouter)[\\/]/,
          priority: 30,
        },
        {
          name: "vendor-query",
          test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
          priority: 20,
        },
        {
          name: "vendor-charts",
          test: /node_modules[\\/](recharts|d3-|victory-vendor)[\\/]/,
          priority: 20,
        },
        {
          name(moduleId: string) {
            const match = moduleId.match(/[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/);
            if (!match) return null;
            return `vendor-${match[1].replace("@", "").replace(/[\\/]/g, "-")}`;
          },
          priority: 1,
        },
      ],
    },
  },
};

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
    rolldownOptions: vendorChunks,
  },
});
