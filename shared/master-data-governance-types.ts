export type MasterDataGovernanceKpis = {
  totalRecords: number;
  draftRecords: number;
  pendingApproval: number;
  activeRecords: number;
  blockedRecords: number;
  dataQualityIssues: number;
  highRiskChanges: number;
  duplicateCandidates: number;
};

export type MasterDataDomainSummary = {
  key: string;
  label: string;
  total: number;
  active: number;
  draft: number;
  blocked: number;
  href: string;
  usedBy: string[];
};

export type MasterDataGovernanceOverview = {
  generatedAt: string;
  meta: {
    queryMs: number;
    partialFailures: Array<{ area: string; code: string; message: string; fallbackUsed: false }>;
  };
  kpis: MasterDataGovernanceKpis;
  domains: MasterDataDomainSummary[];
  qualityIssues: Array<Record<string, unknown>>;
  duplicateCandidates: Array<Record<string, unknown>>;
  pendingChanges: Array<Record<string, unknown>>;
  auditHighlights: Array<Record<string, unknown>>;
};
