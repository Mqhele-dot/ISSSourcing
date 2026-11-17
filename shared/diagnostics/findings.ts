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
export type DiagnosticEvidenceState = "current" | "expected_configuration" | "historical";

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
  /** Safe in-app route that opens the workspace where this finding can be investigated. */
  targetRoute?: string;
  affectedAction?: string;
  remediation?: string;
  evidenceState: DiagnosticEvidenceState;
  requestId?: string;
  resourceKey?: string;
  businessImpact?:string;
  technicalDetails?:{message:string;remediation?:string;rule:string;requestId?:string};
};

/** Only administrator-authorized Diagnostics APIs return this technical envelope. */
export function explainDiagnosticFinding(row:DiagnosticFinding):DiagnosticFinding {
  if(row.technicalDetails)return row;
  const affected=row.status==='failed'||row.status==='degraded';
  const descriptions:Record<string,[string,string,string]>={
    AP_BALANCE_RECONCILIATION:['Some supplier invoice balances cannot be verified.','Affected balances are left out of financial reports until Finance reviews their evidence.','Ask Finance to review opening balances and any recorded corrections.'],
    FINANCIAL_REPORTING_SCHEMA:['Financial reporting setup needs administrator review.','Reports may be unavailable until the approved setup is complete.','Ask your administrator to review reporting prerequisites.'],
    DATABASE_QUERY:['The app checked its connection to saved records.','This connection check alone does not prove every business workflow works.','If pages fail, share this finding with your administrator.'],
    AP_HISTORY_SCHEMA:['The app checked whether invoice-history storage is installed.','Installed storage does not mean opening balances have been verified.','Finance must review opening coverage separately.']};
  const known=descriptions[row.code];
  return {...row,message:known?(affected?known[0]:row.status==='working'?'The setup check completed. Business evidence and workflow verification remain separate.':known[0]):row.message,
    businessImpact:known?.[1]??(affected?'Related work may be delayed or incomplete. Review the evidence before relying on it.':row.status==='not_exercised'?'This function has not been verified by this check.':'This describes the recorded check, not a guarantee that all related actions work.'),
    remediation:known?.[2]??row.remediation??(affected?'Open the related workspace and ask an authorized owner to review this issue.':'No automatic correction is required. Verify the relevant workflow before relying on it.'),
    technicalDetails:{message:row.message,remediation:row.remediation,rule:row.code,requestId:row.requestId}};
}

export type DiagnosticsSummary = {
  generatedAt: string;
  total: number;
  openCount: number;
  byCategory: Record<DiagnosticCategory, number>;
  byStatus: Record<DiagnosticFindingStatus, number>;
  bySeverity: Record<DiagnosticFindingSeverity, number>;
  affectedModules: string[];
};
