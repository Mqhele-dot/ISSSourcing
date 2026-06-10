import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const isReplit = process.env.REPL_ID !== undefined;

const plugins = [react(), themePlugin({ themeJsonPath: path.resolve(projectRoot, "theme.json") })];

if (process.env.NODE_ENV !== "production" && isReplit) {
  const { cartographer } = await import("@replit/vite-plugin-cartographer");
  plugins.push(cartographer());
}

await build(
  defineConfig({
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
    },
  }),
);
