import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const distDir = path.resolve(projectRoot, "dist");
const runtimeDir = path.resolve(distDir, "runtime");
const serverEntryPoint = path.resolve(projectRoot, "server", "index.ts");
const normalizedProjectRoot = projectRoot.toLowerCase();
const isManagedCodexWorktree =
  normalizedProjectRoot.includes(`${path.sep}.codex${path.sep}worktrees${path.sep}`) ||
  normalizedProjectRoot.includes("/.codex/worktrees/");

const isSandboxPathFailure = (error) =>
  error instanceof Error &&
  error.message.includes("Cannot read directory") &&
  error.message.includes("Access is denied");

const MODULE_SPECIFIER_PATTERNS = [
  /(from\s+["'])([^"']+)(["'])/g,
  /(export\s+\*\s+from\s+["'])([^"']+)(["'])/g,
  /(export\s+\{[^}]*\}\s+from\s+["'])([^"']+)(["'])/g,
  /(import\(\s*["'])([^"']+)(["']\s*\))/g,
];

const RUNTIME_TS_COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2020,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
};

async function listSourceFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function fileExists(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

async function resolveSourceModuleCandidate(basePath) {
  const extension = path.extname(basePath).toLowerCase();
  const candidates =
    extension && extension !== ".js"
      ? [basePath]
      : [
          basePath,
          `${basePath}.ts`,
          `${basePath}.js`,
          path.join(basePath, "index.ts"),
          path.join(basePath, "index.js"),
          path.join(basePath, "index.json"),
        ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function toRuntimeOutputPath(sourceFilePath) {
  const relativePath = path.relative(projectRoot, sourceFilePath);
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".json") {
    return path.join(runtimeDir, relativePath);
  }
  return path.join(runtimeDir, relativePath.replace(/\.[^.]+$/, ".js"));
}

function toRuntimeRelativeModulePath(sourceFilePath) {
  const relativePath = path.relative(projectRoot, sourceFilePath);
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".json") {
    return toPosixPath(relativePath);
  }
  return toPosixPath(relativePath.replace(/\.[^.]+$/, ".js"));
}

async function resolveRuntimeTarget(specifier, sourceRelativePath) {
  if (specifier.startsWith("@shared/")) {
    const sharedRelPath = specifier.slice("@shared/".length);
    const resolvedSharedTarget = path.resolve(projectRoot, "shared", sharedRelPath);
    const candidate = await resolveSourceModuleCandidate(resolvedSharedTarget);
    if (!candidate) return specifier;
    const runtimeModulePath = toRuntimeRelativeModulePath(candidate);
    return toPosixPath(path.relative(path.dirname(sourceRelativePath), runtimeModulePath));
  }

  if (!specifier.startsWith(".")) {
    return specifier;
  }

  const sourceModulePath = path.resolve(projectRoot, path.dirname(sourceRelativePath), specifier);
  const candidate = await resolveSourceModuleCandidate(sourceModulePath);
  if (!candidate) {
    return specifier;
  }

  const runtimeModulePath = toRuntimeRelativeModulePath(candidate);
  return toPosixPath(path.relative(path.dirname(sourceRelativePath), runtimeModulePath));
}

async function rewriteModuleSpecifiers(code, sourceRelativePath) {
  let rewritten = code;

  for (const pattern of MODULE_SPECIFIER_PATTERNS) {
    const matches = Array.from(rewritten.matchAll(pattern));
    for (const match of matches) {
      const resolved = await resolveRuntimeTarget(match[2], sourceRelativePath);
      if (resolved === match[2]) {
        continue;
      }
      const normalized = resolved.startsWith(".") ? resolved : `./${resolved}`;
      rewritten = rewritten.replace(match[0], `${match[1]}${normalized}${match[3]}`);
    }
  }

  const unresolvedRelativeSpecifierPattern = /(from\s+["']|import\(\s*["'])(\.\.?\/[^"'.][^"']*)(["']\)?)/g;
  const unresolvedMatches = Array.from(rewritten.matchAll(unresolvedRelativeSpecifierPattern));
  for (const match of unresolvedMatches) {
    const resolved = await resolveRuntimeTarget(match[2], sourceRelativePath);
    if (resolved === match[2]) {
      continue;
    }
    const normalized = resolved.startsWith(".") ? resolved : `./${resolved}`;
    rewritten = rewritten.replace(match[0], `${match[1]}${normalized}${match[3]}`);
  }

  return rewritten;
}

async function copyIfExists(sourcePath, destinationPath) {
  if (await directoryExists(sourcePath)) {
    await fs.cp(sourcePath, destinationPath, { recursive: true });
    return;
  }

  if (await fileExists(sourcePath)) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function buildFromStagedWorkspace() {
  const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "isssourcing-build-server-"));
  const stagingOutDir = path.join(stagingRoot, "dist");

  try {
    await copyIfExists(path.join(projectRoot, "package.json"), path.join(stagingRoot, "package.json"));
    await copyIfExists(path.join(projectRoot, "tsconfig.json"), path.join(stagingRoot, "tsconfig.json"));
    await copyIfExists(path.join(projectRoot, "server"), path.join(stagingRoot, "server"));
    await copyIfExists(path.join(projectRoot, "shared"), path.join(stagingRoot, "shared"));

    await fs.rm(distDir, { recursive: true, force: true });
    await fs.mkdir(distDir, { recursive: true });

    await build({
      absWorkingDir: stagingRoot,
      entryPoints: ["./server/index.ts"],
      platform: "node",
      packages: "external",
      bundle: true,
      format: "esm",
      outdir: stagingOutDir,
    });

    await fs.cp(stagingOutDir, distDir, { recursive: true });
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

async function writeRuntimeFallback() {
  const sourceRoots = [path.resolve(projectRoot, "server"), path.resolve(projectRoot, "shared")];
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeDir, { recursive: true });

  for (const root of sourceRoots) {
    const files = await listSourceFiles(root);
    for (const filePath of files) {
      const relativePath = path.relative(projectRoot, filePath);
      if (relativePath.endsWith(".d.ts")) {
        continue;
      }

      const outputPath = toRuntimeOutputPath(filePath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      if (filePath.endsWith(".json")) {
        await fs.copyFile(filePath, outputPath);
        continue;
      }

      const source = await fs.readFile(filePath, "utf8");
      const transpiled = ts.transpileModule(source, {
        fileName: filePath,
        compilerOptions: RUNTIME_TS_COMPILER_OPTIONS,
      });
      const rewritten = await rewriteModuleSpecifiers(transpiled.outputText, relativePath);
      await fs.writeFile(outputPath, rewritten, "utf8");
    }
  }

  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(
    path.join(distDir, "index.js"),
    [
      "// Fallback for Windows/sandbox environments where esbuild cannot traverse",
      "// the workspace path. Generates a runnable transpiled runtime under dist/runtime.",
      'import "./runtime/server/index.js";',
      "",
    ].join("\n"),
    "utf8",
  );
}

if (isManagedCodexWorktree) {
  console.warn(
    "[build-server] managed Codex worktree detected; skipping esbuild and writing the transpiled runtime fallback for stable Windows automation builds.",
  );
  await writeRuntimeFallback();
} else {
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

    try {
      await buildFromStagedWorkspace();
      console.warn(
        "[build-server] esbuild could not traverse the current Windows workspace path; built the server bundle from a staged temp workspace instead.",
      );
    } catch (stagedBuildError) {
      console.warn(
        "[build-server] staged temp-workspace bundling also failed; writing a transpiled runtime fallback instead.",
      );
      console.warn(stagedBuildError);
      await writeRuntimeFallback();
    }
  }
}
