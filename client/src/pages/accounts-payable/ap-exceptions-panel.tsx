import { AlertTriangle, ArrowRightLeft, Files } from "lucide-react";
import type { Exceptions } from "./types";
import { ExceptionCard } from "./ap-shared";

type Props = {
  exceptions: Exceptions;
  formatMoney: (n: number | null | undefined) => string;
};

export function ApExceptionsPanel({ exceptions, formatMoney }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ExceptionCard
        title="Capture exceptions"
        icon={<Files className="h-4 w-4" />}
        items={exceptions.captureExceptions.map((capture) => ({
          id: capture.id,
          title: capture.invoiceNumber || `Capture #${capture.id}`,
          subtitle: capture.warnings?.join(" | ") || "Requires AP review",
        }))}
      />
      <ExceptionCard
        title="Match exceptions"
        icon={<ArrowRightLeft className="h-4 w-4" />}
        items={exceptions.matchExceptions.map((result) => ({
          id: result.id,
          title: `Invoice #${result.invoiceId}`,
          subtitle:
            result.mismatchSummary?.[0]?.message ||
            `${result.mismatchCount} mismatch(es) require AP resolution`,
        }))}
      />
      <ExceptionCard
        title="Disputed invoices"
        icon={<AlertTriangle className="h-4 w-4" />}
        items={exceptions.disputedInvoices.map((invoice) => ({
          id: invoice.id,
          title: invoice.invoiceNumber,
          subtitle: `Outstanding ${formatMoney(Number(invoice.dueAmount ?? invoice.total ?? 0))}`,
        }))}
      />
    </div>
  );
}
