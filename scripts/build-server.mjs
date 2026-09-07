import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, formatMessages } from "esbuild";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const distDir = path.resolve(projectRoot, "dist");
const runtimeDir = path.resolve(distDir, "runtime");
const MIRRORABLE_BUILD_INPUTS = ["package.json", "tsconfig.json", "server", "shared"];
const forceRuntimeFallback = process.env.BUILD_SERVER_FORCE_TRANSPILE === "1";
const isWindowsOneDriveWorkspace =
  process.platform === "win32" && projectRoot.toLowerCase().includes(`${path.sep}onedrive${path.sep}`);

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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
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

function createBuildOptions(rootDir, outputDir) {
  return {
    absWorkingDir: rootDir,
    entryPoints: ["./server/index.ts"],
    platform: "node",
    packages: "external",
    bundle: true,
    format: "esm",
    outdir: outputDir,
    logLevel: "silent",
  };
}

async function runEsbuild(rootDir, outputDir) {
  return build(createBuildOptions(rootDir, outputDir));
}

async function reportBuildFailure(error) {
  if (error && typeof error === "object" && Array.isArray(error.errors)) {
    const messages = await formatMessages(error.errors, {
      kind: "error",
      color: true,
    });
    for (const message of messages) {
      console.error(message);
    }
    return;
  }

  throw error;
}

async function createMirroredBuildWorkspace() {
  const mirrorRoot = await fs.mkdtemp(path.join(os.tmpdir(), "invtrack-build-"));

  for (const entry of MIRRORABLE_BUILD_INPUTS) {
    const sourcePath = path.resolve(projectRoot, entry);
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    const targetPath = path.resolve(mirrorRoot, entry);
    await fs.cp(sourcePath, targetPath, { recursive: true });
  }

  return mirrorRoot;
}

async function copyBuildOutput(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function buildServerBundleWithMirrorRetry() {
  if (forceRuntimeFallback || isWindowsOneDriveWorkspace) {
    const reason = forceRuntimeFallback ? "BUILD_SERVER_FORCE_TRANSPILE=1" : "Windows OneDrive workspace";
    console.log(`[build-server] using transpiled runtime fallback for ${reason}.`);
    await writeRuntimeFallback();
    return;
  }

  try {
    await runEsbuild(projectRoot, distDir);
    return;
  } catch (error) {
    if (!isSandboxPathFailure(error)) {
      await reportBuildFailure(error);
      throw error;
    }
  }

  const mirrorRoot = await createMirroredBuildWorkspace();
  const mirrorDistDir = path.resolve(mirrorRoot, "dist");

  try {
    await runEsbuild(mirrorRoot, mirrorDistDir);
    await copyBuildOutput(mirrorDistDir, distDir);
  } finally {
    await fs.rm(mirrorRoot, { recursive: true, force: true });
  }
}

try {
  await buildServerBundleWithMirrorRetry();
} catch (error) {
  if (!isSandboxPathFailure(error)) {
    throw error;
  }

  console.warn(
    "[build-server] esbuild could not traverse the current Windows workspace path or mirrored workspace; writing a transpiled runtime fallback instead.",
  );
  await writeRuntimeFallback();
}
