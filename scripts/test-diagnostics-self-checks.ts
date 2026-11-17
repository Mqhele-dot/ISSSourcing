import { runDiagnosticsSelfChecks } from "../shared/diagnostics/self-checks";

const report = runDiagnosticsSelfChecks();

for (const check of report.checks) {
  const prefix = check.ok ? "ok" : "FAIL";
  console.log(`${prefix} ${check.id}: ${check.message}`);
}

if (report.failed > 0) {
  console.error(`Diagnostics self-checks failed: ${report.failed}/${report.checks.length}`);
  process.exit(1);
}

console.log(`Diagnostics self-checks passed: ${report.passed}/${report.checks.length}`);
