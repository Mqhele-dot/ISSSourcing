import type { DiagnosticsScanResult } from "@/api/client";
import type { ReadinessStatus, SetupStatusPayload } from "@/lib/setup-readiness-queries";
import type { SelfCheckReport } from "@shared/diagnostics/self-checks";
import {
  buildDiagnosticsSnapshot,
  redactDiagnosticDetails,
  type DiagnosticEvent,
} from "./diagnostics-store";

export type DiagnosticsReportContext = {
  ready?: ReadinessStatus;
  setup?: SetupStatusPayload | null;
  scan?: DiagnosticsScanResult | null;
  serverSnapshot?: unknown;
  selfChecks?: SelfCheckReport;
};

export type DiagnosticsReportJson = {
  title: "InvTrack Diagnostics Report";
  generatedAt: string;
  currentRoute: string;
  userAgent: string;
  redactionNote: string;
  summary: {
    criticalIssues: number;
    errors: number;
    warnings: number;
    slowRequests: number;
    unresolvedEvents: number;
  };
  healthChecks: {
    ready?: unknown;
    setup?: unknown;
    serverSnapshot?: unknown;
  };
  recentEvents: DiagnosticEvent[];
  apiFailures: DiagnosticEvent[];
  consoleEvents: DiagnosticEvent[];
  routeIssues: DiagnosticEvent[];
  diagnosticsScan?: DiagnosticsScanResult | null;
  selfChecks?: SelfCheckReport;
  suggestedNextActions: string[];
};

function diagnosticGroups(events: DiagnosticEvent[]) {
  return {
    apiFailures: events.filter((event) => event.source === "api" || event.source === "network"),
    consoleEvents: events.filter((event) => event.source === "console"),
    routeIssues: events.filter((event) => event.source === "route" || event.source === "react"),
  };
}

function suggestedNextActions(events: DiagnosticEvent[], context: DiagnosticsReportContext): string[] {
  const out: string[] = [];
  if (context.ready && (context.ready.dbReady === false || context.ready.schemaReady === false)) {
    out.push("Resolve database/schema readiness before debugging page-level failures.");
  }
  if (events.some((event) => event.severity === "critical" && !event.resolved)) {
    out.push("Open the most recent critical event and share the stack/route with a developer.");
  }
  if (events.some((event) => event.source === "api" || event.source === "network")) {
    out.push("Check failed API endpoints, status codes, request IDs, and server logs for matching timestamps.");
  }
  if (context.selfChecks && context.selfChecks.failed > 0) {
    out.push("Run npm run test:diagnostics and inspect failing shared calculation/filter self-checks.");
  }
  if (context.scan && Object.values(context.scan).some((rows) => Array.isArray(rows) && rows.length > 0)) {
    out.push("Review diagnostics scan categories and use fix actions only after confirming they are safe.");
  }
  if (out.length === 0) {
    out.push("No immediate blocking issue detected; keep this report with reproduction steps if the problem continues.");
  }
  return out;
}

export function buildDiagnosticsReportJson(context: DiagnosticsReportContext = {}): DiagnosticsReportJson {
  const snapshot = buildDiagnosticsSnapshot();
  const events = snapshot.events;
  const groups = diagnosticGroups(events);
  const slowRequests = events.filter((event) => event.durationMs != null && event.durationMs >= 3_000).length;

  return {
    title: "InvTrack Diagnostics Report",
    generatedAt: snapshot.generatedAt,
    currentRoute: snapshot.currentRoute,
    userAgent: snapshot.userAgent,
    redactionNote:
      "Sensitive values such as Authorization headers, cookies, tokens, passwords, API keys, secrets, and session IDs are redacted before persistence/export.",
    summary: {
      criticalIssues: snapshot.counts.critical,
      errors: snapshot.counts.error,
      warnings: snapshot.counts.warning,
      slowRequests,
      unresolvedEvents: snapshot.unresolvedCount,
    },
    healthChecks: {
      ready: redactDiagnosticDetails(context.ready),
      setup: redactDiagnosticDetails(context.setup),
      serverSnapshot: redactDiagnosticDetails(context.serverSnapshot),
    },
    recentEvents: events,
    apiFailures: groups.apiFailures,
    consoleEvents: groups.consoleEvents,
    routeIssues: groups.routeIssues,
    diagnosticsScan: context.scan ?? null,
    selfChecks: context.selfChecks,
    suggestedNextActions: suggestedNextActions(events, context),
  };
}

function listEvents(events: DiagnosticEvent[]): string {
  if (events.length === 0) return "- None recorded.\n";
  return events
    .slice(0, 25)
    .map((event) => {
      const endpoint = event.endpoint ? ` (${event.method ?? "GET"} ${event.endpoint})` : "";
      const status = event.status != null ? ` HTTP ${event.status}` : "";
      const duration = event.durationMs != null ? ` ${Math.round(event.durationMs)}ms` : "";
      return `- [${event.severity}] ${event.timestamp} ${event.title}${endpoint}${status}${duration}: ${event.message}`;
    })
    .join("\n")
    .concat("\n");
}

function scanMarkdown(scan: DiagnosticsScanResult | null | undefined): string {
  if (!scan) return "- No diagnostics scan result captured.\n";
  const sections = Object.entries(scan);
  if (sections.length === 0 || sections.every(([, rows]) => rows.length === 0)) {
    return "- Diagnostics scan returned no issues.\n";
  }
  return sections
    .map(([category, rows]) =>
      rows.length > 0
        ? `### ${category}\n${rows.map((row) => `- ${row}`).join("\n")}\n`
        : `### ${category}\n- No issues.\n`,
    )
    .join("\n");
}

export function buildDiagnosticsReportMarkdown(context: DiagnosticsReportContext = {}): string {
  const report = buildDiagnosticsReportJson(context);
  return `# InvTrack Diagnostics Report

## Summary
- Generated: ${report.generatedAt}
- Current route: ${report.currentRoute || "unknown"}
- Critical issues: ${report.summary.criticalIssues}
- Errors: ${report.summary.errors}
- Warnings: ${report.summary.warnings}
- Slow requests: ${report.summary.slowRequests}

## Health Checks
- App ready: ${context.ready ? (context.ready.dbReady && context.ready.schemaReady ? "yes" : "degraded") : "not captured"}
- Database ready: ${context.ready?.dbReady ?? "unknown"}
- Schema ready: ${context.ready?.schemaReady ?? "unknown"}
- Session store ready: ${context.ready?.sessionStoreReady ?? "unknown"}
- Setup status: ${context.setup?.setupStatusHealth ?? "unknown"}

## Recent Errors
${listEvents(report.recentEvents.filter((event) => event.severity === "error" || event.severity === "critical"))}

## API Failures
${listEvents(report.apiFailures)}

## Console Warnings And Errors
${listEvents(report.consoleEvents)}

## Route Issues
${listEvents(report.routeIssues)}

## Diagnostics Scan
${scanMarkdown(report.diagnosticsScan)}

## Internal Calculation And Filter Self-Checks
- Passed: ${context.selfChecks?.passed ?? "not run"}
- Failed: ${context.selfChecks?.failed ?? "not run"}
${context.selfChecks?.checks?.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`).join("\n") ?? ""}

## Suggested Next Actions
${report.suggestedNextActions.map((action) => `- ${action}`).join("\n")}

## Redaction Note
${report.redactionNote}
`;
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadDiagnosticsJson(context: DiagnosticsReportContext = {}): void {
  downloadText(
    "invtrack-diagnostics-report.json",
    JSON.stringify(buildDiagnosticsReportJson(context), null, 2),
    "application/json",
  );
}

export function downloadDiagnosticsMarkdown(context: DiagnosticsReportContext = {}): void {
  downloadText(
    "invtrack-diagnostics-report.md",
    buildDiagnosticsReportMarkdown(context),
    "text/markdown",
  );
}

export async function copyDiagnosticsSummary(context: DiagnosticsReportContext = {}): Promise<void> {
  await navigator.clipboard.writeText(buildDiagnosticsReportMarkdown(context));
}
