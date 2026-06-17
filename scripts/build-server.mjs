import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const distDir = path.resolve(projectRoot, "dist");
const serverEntryPoint = path.resolve(projectRoot, "server", "index.ts");

const isSandboxPathFailure = (error) =>
  error instanceof Error &&
  error.message.includes("Cannot read directory") &&
  error.message.includes("Access is denied");

const writeRuntimeFallback = async () => {
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(
    path.join(distDir, "index.js"),
    [
      'import { tsImport } from "tsx/esm/api";',
      "",
      "// Fallback for Windows/sandbox environments where esbuild cannot resolve",
      "// the repo worktree even though the TypeScript sources are readable.",
      'await tsImport("../server/index.ts", { parentURL: import.meta.url });',
      "",
    ].join("\n"),
    "utf8",
  );
};

try {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [serverEntryPoint],
    platform: "node",
    packages: "external",
    bundle: true,
    format: "esm",
    outdir: distDir,
  });
} catch (error) {
  if (!isSandboxPathFailure(error)) {
    throw error;
  }

  console.warn(
    "[build-server] esbuild could not traverse the current Windows workspace path; writing a tsx runtime fallback instead.",
  );
  await writeRuntimeFallback();
}
