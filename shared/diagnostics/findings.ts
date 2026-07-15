export const diagnosticCategories = [
  "overview",
  "user-errors",
  "frontend",
  "backend",
  "business",
  "integrations",
  "consistency",
  "notifications",
  "security",
  "audit",
] as const;

export type DiagnosticCategory = (typeof diagnosticCategories)[number];

export const diagnosticFindingStatuses = [
  "working",
  "failed",
  "degraded",
  "disabled_by_configuration",
  "not_exercised",
  "not_applicable",
] as const;

export type DiagnosticFindingStatus = (typeof diagnosticFindingStatuses)[number];
export type DiagnosticFindingSeverity = "info" | "warning" | "error" | "critical";

export type DiagnosticFinding = {
  id: string;
  category: DiagnosticCategory;
  severity: DiagnosticFindingSeverity;
  status: DiagnosticFindingStatus;
  code: string;
  title: string;
  message: string;
  evidence?: unknown;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  affectedRoute?: string;
  affectedAction?: string;
  remediation?: string;
};

export type DiagnosticsSummary = {
  generatedAt: string;
  total: number;
  openCount: number;
  byCategory: Record<DiagnosticCategory, number>;
  byStatus: Record<DiagnosticFindingStatus, number>;
  bySeverity: Record<DiagnosticFindingSeverity, number>;
  affectedModules: string[];
};
