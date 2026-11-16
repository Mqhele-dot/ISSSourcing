import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { requestJson } from "@/lib/queryClient";
import { userFacingError } from "@/lib/user-facing-error";

type Evidence = {
  agreementVersion: number | null;
  capturedAt?: string;
  agreement?: { reference: string; currencyCode: string; releaseAmount: string; maximumValue: string | null; committedValueBefore: string };
  supplier?: { status: string | null; complianceStatus: string | null };
  approval?: { level: number; policyId: number | null; policyVersion: number | null };
  budgetReservation?: { transferred: boolean } | null;
  lines: Array<{ purchaseOrderItemId: number; lineNumber: number; description: string; quantity: string; unitPrice: string;
    priceBreak: { minimumQuantity: string } | null }>;
  hasNext: boolean;
};

export function AgreementReleaseEvidence({ agreementId, releaseId }: { agreementId: number; releaseId: string }) {
  const [page, setPage] = useState(1);
  const { user } = useAuth();
  const org = (user as typeof user & { activeOrganizationId?: number })?.activeOrganizationId;
  const evidence = useQuery({
    queryKey: ["agreement-release-evidence", org, user?.id, user?.warehouseId, agreementId, releaseId, page],
    queryFn: () => requestJson<Evidence>("GET", `/api/v2/procurement/contracts/${agreementId}/releases/${encodeURIComponent(releaseId)}/evidence?page=${page}`),
    enabled: !!user, retry: false, gcTime: 0,
  });
  const data = evidence.data;
  return <section aria-label="Agreement release evidence" className="min-w-0 space-y-3 break-words rounded border p-3 text-sm">
    <h3 className="font-semibold">Agreement release evidence</h3>
    {evidence.isPending ? <p role="status">Loading release evidence…</p> : evidence.isError ? <>
      <p role="alert">{userFacingError(evidence.error)}</p><Button variant="outline" onClick={() => void evidence.refetch()}>Retry release evidence</Button>
    </> : !data?.agreementVersion || !data.agreement ? <p>No agreement version was captured for this release. The current agreement is not historical evidence.</p> : <>
      <p><strong>{data.agreement.reference} v{data.agreementVersion}</strong> · Captured {data.capturedAt ? new Date(data.capturedAt).toLocaleString() : "date unavailable"}</p>
      <p>Release value: {data.agreement.currencyCode} {data.agreement.releaseAmount} · Committed before release: {data.agreement.currencyCode} {data.agreement.committedValueBefore}</p>
      {data.approval?.policyId && <p>Final release approval: policy #{data.approval.policyId} v{data.approval.policyVersion}, level {data.approval.level}</p>}
      {data.supplier && <p>Supplier at release: {data.supplier.status ?? "status unavailable"} · Compliance status: {data.supplier.complianceStatus ?? "not recorded"}</p>}
      {data.budgetReservation && <p>{data.budgetReservation.transferred
        ? "Existing budget reservation transferred unchanged to the purchase order."
        : "No active requisition budget reservation was recorded at release."}</p>}
      <ul className="space-y-2">{data.lines.map(line => <li key={line.purchaseOrderItemId} className="rounded border p-2">
        <strong>Line {line.lineNumber}: {line.description}</strong>
        <p>Quantity {line.quantity} · Unit price {data.agreement?.currencyCode} {line.unitPrice} · {line.priceBreak ? `Price tier from ${line.priceBreak.minimumQuantity}` : "Base price"}</p>
      </li>)}</ul>
      {(page > 1 || data.hasNext) && <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous release lines</Button>
        <Button variant="outline" disabled={!data.hasNext} onClick={() => setPage(value => value + 1)}>Next release lines</Button>
      </div>}
      <p className="text-muted-foreground">This is the decision recorded at release, not a check of later changes to the purchase order.</p>
    </>}
  </section>;
}
