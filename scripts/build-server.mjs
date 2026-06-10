import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

await build({
  absWorkingDir: projectRoot,
  entryPoints: [path.resolve(projectRoot, "server", "index.ts")],
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  outdir: path.resolve(projectRoot, "dist"),
});
