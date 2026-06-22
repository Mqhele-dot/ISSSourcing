import fs from "node:fs";
import path from "node:path";

export type GateStatus = "pass" | "fail" | "warn" | "unknown" | "skipped";

export type SecurityReleaseGate = {
  label: string;
  status: GateStatus;
  details?: string | null;
};

export type SecurityAuditFinding = {
  package: string;
  severity: string;
  via: string[];
};

export type SecurityReleaseStatus = {
  generatedAt: string;
  source: "artifact" | "fallback";
  files: {
    statusFilePath: string;
    statusFilePresent: boolean;
    auditFilePath: string;
    auditFilePresent: boolean;
  };
  gates: Record<string, SecurityReleaseGate>;
  audit: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    topFindings: SecurityAuditFinding[];
  } | null;
  summary: {
    overall: "healthy" | "blocked" | "unknown";
    blockingGates: string[];
    blockingReasons: string[];
  };
  nextAction: string;
};

type NpmAuditVulnerability = {
  severity?: string;
  via?: Array<string | { source?: number; title?: string; name?: string }>;
};

type NpmAuditPayload = {
  metadata?: {
    vulnerabilities?: {
      critical?: number;
      high?: number;
      moderate?: number;
      low?: number;
    };
  };
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
};

const DEFAULT_GATES: Record<string, SecurityReleaseGate> = {
  packageManifests: { label: "Package manifests", status: "unknown" },
  lifecycle: { label: "Lifecycle allowlist", status: "unknown" },
  auditSignatures: { label: "Registry signatures", status: "unknown" },
  auditHigh: { label: "npm audit high gate", status: "unknown" },
  dependencyReview: { label: "Dependency review", status: "unknown" },
  prSecurityMergeGate: { label: "PR security merge gate", status: "unknown" },
  build: { label: "Build", status: "unknown" },
  orgApiIsolation: { label: "Org API isolation", status: "unknown" },
  playwrightCoverage: { label: "Playwright coverage", status: "unknown" },
  releaseGate: { label: "Release gate", status: "unknown" },
};

function isGateStatus(value: unknown): value is GateStatus {
  return value === "pass" || value === "fail" || value === "warn" || value === "unknown" || value === "skipped";
}

function normalizeGateStatus(value: unknown): GateStatus {
  if (isGateStatus(value)) return value;
  if (typeof value !== "string") return "unknown";

  const normalized = value.trim().toLowerCase();
  if (normalized === "success" || normalized === "passed" || normalized === "pass") return "pass";
  if (normalized === "failure" || normalized === "failed" || normalized === "fail") return "fail";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "skipped") return "skipped";
  if (normalized === "warning" || normalized === "warn") return "warn";
  return "unknown";
}

function severityRank(value: unknown): number {
  switch (String(value ?? "").toLowerCase()) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "moderate":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function summarizeAuditPayload(payload: unknown): SecurityReleaseStatus["audit"] {
  if (!payload || typeof payload !== "object") return null;

  const audit = payload as NpmAuditPayload;
  const counts = audit.metadata?.vulnerabilities ?? {};
  const vulnerabilities = Object.entries(audit.vulnerabilities ?? {});

  const topFindings = vulnerabilities
    .filter(([, entry]) => typeof entry?.severity === "string")
    .sort((a, b) => severityRank(b[1]?.severity) - severityRank(a[1]?.severity))
    .slice(0, 5)
    .map(([pkg, entry]) => ({
      package: pkg,
      severity: entry?.severity ?? "unknown",
      via: (entry?.via ?? [])
        .slice(0, 3)
        .map((via) => {
          if (typeof via === "string") return via;
          return via.title ?? via.name ?? `advisory-${via.source ?? "unknown"}`;
        }),
    }));

  return {
    critical: Number(counts.critical ?? 0),
    high: Number(counts.high ?? 0),
    moderate: Number(counts.moderate ?? 0),
    low: Number(counts.low ?? 0),
    topFindings,
  };
}

function readJsonFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mergeGates(input: unknown): Record<string, SecurityReleaseGate> {
  const resolved = { ...DEFAULT_GATES };
  if (!input || typeof input !== "object") return resolved;

  for (const [key, gate] of Object.entries(input as Record<string, unknown>)) {
    const existing = resolved[key] ?? { label: key, status: "unknown" as GateStatus };
    if (!gate || typeof gate !== "object") {
      resolved[key] = { ...existing, status: normalizeGateStatus(gate) };
      continue;
    }

    const row = gate as { label?: unknown; status?: unknown; details?: unknown };
    resolved[key] = {
      label: typeof row.label === "string" && row.label.trim().length > 0 ? row.label : existing.label,
      status: normalizeGateStatus(row.status),
      details: typeof row.details === "string" ? row.details : existing.details ?? null,
    };
  }

  return resolved;
}

function summarizeStatus(
  gates: Record<string, SecurityReleaseGate>,
  audit: SecurityReleaseStatus["audit"],
): SecurityReleaseStatus["summary"] {
  const blockingGates = Object.entries(gates)
    .filter(([, gate]) => gate.status === "fail")
    .map(([key]) => key);
  const blockingReasons = Object.values(gates)
    .filter((gate) => gate.status === "fail")
    .map((gate) => `${gate.label}${gate.details ? `: ${gate.details}` : ""}`);

  if ((audit?.critical ?? 0) > 0 || (audit?.high ?? 0) > 0) {
    blockingReasons.push(
      `npm audit reports ${audit?.critical ?? 0} critical and ${audit?.high ?? 0} high vulnerabilities.`,
    );
  }

  if (blockingGates.length > 0 || (audit?.critical ?? 0) > 0 || (audit?.high ?? 0) > 0) {
    return {
      overall: "blocked",
      blockingGates,
      blockingReasons,
    };
  }

  const allUnknown = Object.values(gates).every((gate) => gate.status === "unknown");
  if (allUnknown && !audit) {
    return {
      overall: "unknown",
      blockingGates: [],
      blockingReasons: ["No security/release status artifact has been generated for this workspace yet."],
    };
  }

  return {
    overall: "healthy",
    blockingGates: [],
    blockingReasons: [],
  };
}

function nextActionFor(summary: SecurityReleaseStatus["summary"]): string {
  if (summary.overall === "blocked") {
    return summary.blockingReasons[0] ?? "Resolve the first failing security/release gate before trusting release output.";
  }
  if (summary.overall === "unknown") {
    return "Run the CI status writer or generate a local security status artifact before using this as release evidence.";
  }
  return "No blocking security or release gates are recorded in the latest status artifact.";
}

export function loadSecurityReleaseStatus(projectRoot = process.cwd()): SecurityReleaseStatus {
  const statusFilePath = path.join(projectRoot, "artifacts", "security-release-status.json");
  const auditFilePath = path.join(projectRoot, "artifacts", "npm-audit.json");
  const statusPayload = readJsonFile(statusFilePath) as
    | {
        generatedAt?: unknown;
        gates?: unknown;
        audit?: unknown;
      }
    | null;
  const auditPayload = readJsonFile(auditFilePath);

  const gates = mergeGates(statusPayload?.gates);
  const audit = summarizeAuditPayload(statusPayload?.audit ?? auditPayload);
  const summary = summarizeStatus(gates, audit);

  return {
    generatedAt:
      typeof statusPayload?.generatedAt === "string" && statusPayload.generatedAt.trim().length > 0
        ? statusPayload.generatedAt
        : new Date().toISOString(),
    source: statusPayload ? "artifact" : "fallback",
    files: {
      statusFilePath,
      statusFilePresent: fs.existsSync(statusFilePath),
      auditFilePath,
      auditFilePresent: fs.existsSync(auditFilePath),
    },
    gates,
    audit,
    summary,
    nextAction: nextActionFor(summary),
  };
}
