import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import {acquireE2eWorkspaceLock} from "./e2e-workspace-lock.mjs";

// This command packages production assets even when a local runner loaded a
// development .env first. Never ship React's development runtime by accident.
process.env.NODE_ENV = "production";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const releaseBuildLock=acquireE2eWorkspaceLock(path.join(projectRoot,"test-results"));
process.once("exit",releaseBuildLock);
const isReplit = process.env.REPL_ID !== undefined;

const plugins = [react(), themePlugin({ themeJsonPath: path.resolve(projectRoot, "theme.json") })];
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
          name(moduleId) {
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

if (process.env.NODE_ENV !== "production" && isReplit) {
  const { cartographer } = await import("@replit/vite-plugin-cartographer");
  plugins.push(cartographer());
}

await build(
  defineConfig({
    mode: "production",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    server: {
      fs: {
        allow: [projectRoot],
      },
      watch: {
        ignored: ["**/node_modules/**", "**/.git/objects/**"],
        awaitWriteFinish: { stabilityThreshold: 450, pollInterval: 100 },
      },
    },
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "client", "src"),
        "@shared": path.resolve(projectRoot, "shared"),
        "@assets": path.resolve(projectRoot, "attached_assets"),
      },
    },
    root: path.resolve(projectRoot, "client"),
    build: {
      outDir: path.resolve(projectRoot, "dist/public"),
      emptyOutDir: true,
      rolldownOptions: vendorChunks,
    },
  }),
);
