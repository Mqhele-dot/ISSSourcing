#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const buildServerScript = readFileSync(new URL("../scripts/build-server.mjs", import.meta.url), "utf8");

assert.match(
  buildServerScript,
  /import os from "node:os";/,
  "build-server hardening should stage a temp workspace before falling back",
);
assert.match(
  buildServerScript,
  /async function buildFromStagedWorkspace\(\)/,
  "build-server should attempt a staged temp-workspace bundle",
);
assert.match(
  buildServerScript,
  /isManagedCodexWorktree/,
  "build-server should detect managed Codex worktrees and skip doomed esbuild attempts",
);
assert.match(
  buildServerScript,
  /entryPoints:\s*\["\.\/server\/index\.ts"\]/,
  "staged temp-workspace builds should use a repo-relative server entrypoint",
);
assert.match(
  buildServerScript,
  /await fs\.cp\(stagingOutDir, distDir, \{ recursive: true \}\);/,
  "staged temp-workspace builds should copy the bundled output back into dist",
);
assert.match(
  buildServerScript,
  /import ts from "typescript";/,
  "build-server fallback should transpile TypeScript instead of depending on tsx runtime import",
);
assert.match(
  buildServerScript,
  /import "\.\/runtime\/server\/index\.js";/,
  "build-server fallback should launch the generated dist runtime entrypoint",
);
assert.doesNotMatch(
  buildServerScript,
  /tsx\/esm\/api/,
  "build-server fallback should no longer depend on tsx source-tree execution",
);
assert.match(
  buildServerScript,
  /MODULE_SPECIFIER_PATTERNS[\s\S]*@shared\//,
  "build-server fallback should rewrite @shared imports for emitted runtime files",
);

console.log("test-build-server-fallback: all checks passed.");
