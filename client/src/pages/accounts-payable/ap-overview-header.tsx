import { AlertTriangle, CheckCircle2, Files, ShieldCheck, Wallet } from "lucide-react";
import { KpiCard } from "./ap-shared";
import type { Overview } from "./types";

type Props = {
  stats: Overview;
  formatMoney: (value: number | null | undefined) => string;
};

export function ApOverviewHeader({ stats, formatMoney }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <KpiCard
        title="Capture review"
        value={stats.captureReviewCount}
        hint="Staged invoices needing AP review"
        icon={<Files className="h-4 w-4 text-muted-foreground" />}
      />
      <KpiCard
        title="Pending approvals"
        value={stats.pendingApprovalCount}
        hint="Invoices waiting for approvers"
        icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      />
      <KpiCard
        title="Exceptions"
        value={stats.exceptionCount + stats.disputedCount}
        hint="Match failures and disputed invoices"
        icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
      />
      <KpiCard
        title="Approved for pay"
        value={stats.approvedCount}
        hint="Invoices ready for batching"
        icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
      />
      <KpiCard
        title="Outstanding"
        value={formatMoney(stats.outstandingAmount ?? 0)}
        hint="Current unpaid AP exposure"
        icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
      />
    </div>
  );
}
