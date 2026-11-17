#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const buildServerScript = readFileSync(new URL("../scripts/build-server.mjs", import.meta.url), "utf8");

assert.match(
  buildServerScript,
  /createMirroredBuildWorkspace/,
  "build-server should retry bundling from a mirrored temp workspace before falling back",
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
