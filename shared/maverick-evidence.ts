export const maverickEvidenceFamilies = {
  budget: "Requisition budget",
  sourcingOverride: "Sourcing override",
  agreementRelease: "Agreement release",
  poSubmission: "PO submission",
  poConversion: "Requisition conversion",
} as const;

export type MaverickEvidenceFamily = keyof typeof maverickEvidenceFamilies;
export type MaverickEvidenceCoverage = Record<MaverickEvidenceFamily, "recorded" | "unverified" | "not_linked">;
