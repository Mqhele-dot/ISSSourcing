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

assertContains("server/index.ts", /api\/startup-diagnostics/, "startup diagnostics endpoint");
assertContains("server/index.ts", /Development\/Codespaces mode: continuing/, "development startup recovery");
assertContains("server/config/env.ts", /INTERNAL_EXPORT_TOKEN/, "scoped internal export token env");
assertContains("server/routes.ts", /appEnv\.internalExportToken/, "scoped internal export token usage");
assertContains("server/modules/exports/export-worker.ts", /appEnv\.internalExportToken/, "scoped internal export worker token usage");
assertNotContains("server/routes.ts", /x-internal-export-key"\)\s*===\s*appEnv\.sessionSecret/, "SESSION_SECRET export bypass");
assertContains("server/auth.ts", /api\/user\/permissions/, "current user permissions endpoint");
assertContains("server/auth.ts", /allowUnverifiedEmailLogin/, "explicit email verification bypass");
assertContains("server/auth.ts", /suspiciousLoginAlertsEnabled/, "suspicious login feature flag");
assertContains("server/auth.ts", /redactAuditDetails\(req\.body\)/, "admin audit redaction");
assertContains("server/bootstrap/security-middleware.ts", /nonce-/, "production CSP nonce");
assertNotContains("server/bootstrap/security-middleware.ts", /:\s*\["'self'",\s*"'unsafe-inline'"\]\s*,\s*\n\s*\}\s*,\s*\n\s*\}\s*,\s*\n\s*referrerPolicy/, "unconditional unsafe-inline CSP");
assertContains("server/modules/accounts-payable/register-ap-routes.ts", /ensureTwoFactorAuthenticated/, "AP high-risk 2FA");
assertContains("client/src/hooks/use-permissions.tsx", /\/api\/user\/permissions/, "frontend current user permissions");

console.log("Security hardening contract checks passed.");
