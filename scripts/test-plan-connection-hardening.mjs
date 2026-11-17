#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertContains(file, pattern, label) {
  const text = read(file);
  if (!pattern.test(text)) {
    throw new Error(`${label} missing in ${file}`);
  }
}

function assertNotContains(file, pattern, label) {
  const text = read(file);
  if (pattern.test(text)) {
    throw new Error(`${label} still present in ${file}`);
  }
}

assertContains(
  "server/modules/extensions/register-extensions.ts",
  /PROJECTS_EXTENSION_UNAVAILABLE/,
  "visible projects extension failure",
);
assertNotContains(
  "server/modules/extensions/register-extensions.ts",
  /catch \(e\)[\s\S]{0,160}sendOk\(res,\s*\[\]\)/,
  "hidden projects extension fallback",
);
assertContains(
  "server/modules/rbac/register-rbac-routes.ts",
  /\/api\/permissions\/me/,
  "current user permission summary endpoint",
);
assertContains(
  "client/src/hooks/use-permissions.tsx",
  /\/api\/permissions\/me/,
  "frontend permission hook uses current user endpoint",
);
assertContains(
  "server/modules/master-data/register-master-data-routes.ts",
  /deleteCheck === "true"/,
  "master-data delete dependency preflight",
);
assertContains(
  "server/modules/master-data/register-master-data-routes.ts",
  /getDeleteDependencies/,
  "master-data dependency counter",
);
assertContains(
  "server/proxy.ts",
  /import \{ WebSocket, WebSocketServer \} from 'ws'/,
  "typed websocket proxy import",
);

console.log("Plan connection hardening checks passed.");
