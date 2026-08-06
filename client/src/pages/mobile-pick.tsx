import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { ChevronRight, MapPin } from "lucide-react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { DataState } from "@/components/ui/data-state";
import { fetchInventory, type InventoryListItem } from "@/api/client";
import type { FallbackKind } from "@/components/ui/data-state";

/**
 * Touch-first picking helper: surfaces SKUs that are at/below threshold using operational stock.
 */
export default function MobilePickPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const fetcher = useCallback(async () => {
    try {
      const rows = await fetchInventory({ lowStock: true });
      return { data: rows, meta: undefined as { fallback?: FallbackKind } | undefined };
    } catch (e) {
      console.warn("[mobile-pick] fetchInventory failed:", e);
      toastRef.current({
        title: "Could not load low-stock list",
        description: e instanceof Error ? e.message : "Check network or try Refresh.",
        variant: "destructive",
      });
      return { data: [] as InventoryListItem[], meta: { fallback: "degraded" as FallbackKind } };
    }
  }, []);

  const { loading, error, data: bundle, refetch } = useAsyncResource(fetcher);
  const fallback = bundle?.meta?.fallback as FallbackKind | undefined;

  const sorted = useMemo(() => {
    const rows = bundle?.data ?? [];
    return [...rows].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  }, [bundle?.data]);

  return (
    <div className="mx-auto max-w-lg px-3 pb-24 pt-2 md:max-w-2xl" data-testid="mobile-pick-page">
      <PageHeader
        title="Pick / low-stock (mobile)"
        subtitle="Large rows for floor use. Opens SKU detail for location and adjustments."
        breadcrumb={<Link href={APP_ROUTES.inventory.warehouseOperations}>← Warehouse ops</Link>}
      />

      <p className="mb-4 text-xs text-muted-foreground md:text-sm">
        For barcode-driven moves, use the main <Link href={APP_ROUTES.inventory.barcodeScanner}>Barcode Scanner</Link> page.
      </p>

      <DataState
        loading={loading}
        error={error}
        data={sorted}
        isEmpty={(list) => list.length === 0}
        emptyTitle="No low-stock SKUs"
        emptyDescription="Nothing matched the low-stock filter, or inventory service is unavailable."
        fallback={fallback}
        onRetry={refetch}
      >
        {(list) => (
          <ul className="flex flex-col gap-2">
            {list.map((item) => (
              <li key={item.sku}>
                <Link
                  href={`/inventory/${encodeURIComponent(item.sku)}`}
                  className="flex min-h-[56px] items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm active:bg-accent/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-semibold">{item.sku}</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Avail {item.available ?? 0} · On hand {item.onHand ?? item.quantity ?? 0} · Threshold{" "}
                      {item.lowStockThreshold}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </div>
  );
}
