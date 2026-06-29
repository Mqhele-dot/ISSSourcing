import { useCallback, useMemo } from "react";
import { Link } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { ChevronRight, Package } from "lucide-react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { fetchPurchaseOrdersEnvelope } from "@/features/purchase-orders";
import type { PurchaseOrderListItem } from "@/api/types";
import type { FallbackKind } from "@/components/ui/data-state";

/**
 * Touch-friendly list of POs that can be received (approved or sent).
 * Opens full receive UI on the standard PO detail page.
 */
export default function MobileReceivePage() {
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const envApproved = await fetchPurchaseOrdersEnvelope({ status: "approved" }, { signal });
    const envSent = await fetchPurchaseOrdersEnvelope({ status: "sent" }, { signal });
    const map = new Map<string, PurchaseOrderListItem>();
    for (const o of envApproved.data ?? []) map.set(o.poNumber, o);
    for (const o of envSent.data ?? []) map.set(o.poNumber, o);
    const merged = Array.from(map.values()).sort((a, b) => b.poNumber.localeCompare(a.poNumber));
    return {
      data: merged,
      meta: envSent.meta?.fallback || envApproved.meta?.fallback
        ? { fallback: (envSent.meta?.fallback ?? envApproved.meta?.fallback) as FallbackKind }
        : undefined,
    };
  }, []);

  const { loading, error, data: bundle, refetch } = useAsyncResource(fetcher, { abortable: true });
  const rows = bundle?.data ?? [];
  const fallback = bundle?.meta?.fallback as FallbackKind | undefined;

  const hint = useMemo(
    () =>
      "Use device camera / barcode from the main Barcode Scanner page if you scan SKU at the dock.",
    [],
  );

  return (
    <div className="mx-auto max-w-lg px-3 pb-24 pt-2 md:max-w-2xl" data-testid="mobile-receive-page">
      <PageHeader
        title="Receive on mobile"
        subtitle="Large tap targets for warehouse floor. Pick a PO to enter quantities on the receive panel."
        breadcrumb={<Link href="/inventory">← Inventory</Link>}
      />

      <p className="mb-4 text-xs text-muted-foreground md:text-sm">{hint}</p>

      <DataState
        loading={loading}
        error={error}
        data={rows}
        isEmpty={(list) => list.length === 0}
        emptyTitle="No POs to receive"
        emptyDescription="Approve and send purchase orders first, or check operations data / demo seed."
        emptyAction={
          <Link
            href={APP_ROUTES.procurement.orders}
            className="text-primary text-sm font-medium underline underline-offset-2"
          >
            Go to Purchase
          </Link>
        }
        fallback={fallback}
        onRetry={refetch}
      >
        {(list) => (
          <ul className="flex flex-col gap-2">
            {list.map((po) => (
              <li key={po.poNumber}>
                <Link
                  href={`/purchase/${encodeURIComponent(po.poNumber)}`}
                  className="flex min-h-[56px] items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm active:bg-accent/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Package className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-semibold">{po.poNumber}</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {po.supplierName ?? `Supplier #${po.supplierId}`} · {po.status}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {po.receivedProgress ?? 0}% received · {po.linesCount ?? 0} lines
                    </p>
                  </div>
                  <ChevronRight className="h-6 w-6 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </div>
  );
}
