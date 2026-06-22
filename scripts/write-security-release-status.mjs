#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const artifactsDir = path.join(root, "artifacts");
const statusPath = path.join(artifactsDir, "security-release-status.json");
const auditPath = path.join(artifactsDir, "npm-audit.json");

function normalizeGateStatus(value) {
  const normalized = String(value ?? "unknown").trim().toLowerCase();
  if (normalized === "success" || normalized === "pass" || normalized === "passed") return "pass";
  if (normalized === "failure" || normalized === "fail" || normalized === "failed") return "fail";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "skipped") return "skipped";
  if (normalized === "warning" || normalized === "warn") return "warn";
  return "unknown";
}

function readAuditPayload() {
  if (!fs.existsSync(auditPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(auditPath, "utf8"));
  } catch {
    return null;
  }
}

const gates = {
  packageManifests: {
    label: "Package manifests",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_PACKAGE_MANIFESTS),
    details: process.env.SECURITY_STATUS_PACKAGE_MANIFESTS_DETAILS || null,
  },
  lifecycle: {
    label: "Lifecycle allowlist",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_LIFECYCLE),
    details: process.env.SECURITY_STATUS_LIFECYCLE_DETAILS || null,
  },
  auditSignatures: {
    label: "Registry signatures",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_AUDIT_SIGNATURES),
    details: process.env.SECURITY_STATUS_AUDIT_SIGNATURES_DETAILS || null,
  },
  auditHigh: {
    label: "npm audit high gate",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_AUDIT_HIGH),
    details: process.env.SECURITY_STATUS_AUDIT_HIGH_DETAILS || null,
  },
  dependencyReview: {
    label: "Dependency review",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_DEPENDENCY_REVIEW),
    details: process.env.SECURITY_STATUS_DEPENDENCY_REVIEW_DETAILS || null,
  },
  prSecurityMergeGate: {
    label: "PR security merge gate",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_PR_SECURITY_GATE),
    details: process.env.SECURITY_STATUS_PR_SECURITY_GATE_DETAILS || null,
  },
  build: {
    label: "Build",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_BUILD),
    details: process.env.SECURITY_STATUS_BUILD_DETAILS || null,
  },
  orgApiIsolation: {
    label: "Org API isolation",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_ORG_API_ISOLATION),
    details: process.env.SECURITY_STATUS_ORG_API_ISOLATION_DETAILS || null,
  },
  playwrightCoverage: {
    label: "Playwright coverage",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_PLAYWRIGHT),
    details: process.env.SECURITY_STATUS_PLAYWRIGHT_DETAILS || null,
  },
  releaseGate: {
    label: "Release gate",
    status: normalizeGateStatus(process.env.SECURITY_STATUS_RELEASE_GATE),
    details: process.env.SECURITY_STATUS_RELEASE_GATE_DETAILS || null,
  },
};

fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(
  statusPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "ci",
      gates,
      audit: readAuditPayload(),
      notes: process.env.SECURITY_STATUS_NOTES || null,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`Wrote ${statusPath}`);
