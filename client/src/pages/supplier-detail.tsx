import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { requestJson } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { parseSupplierRouteId, SUPPLIER_DETAIL_ROUTE_PATTERN } from "@/lib/supplier-detail-route";

export default function SupplierDetailPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute<{ id: string }>(SUPPLIER_DETAIL_ROUTE_PATTERN);
  const parsed = parseSupplierRouteId(params?.id);
  const id = parsed.ok ? parsed.id : NaN;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/suppliers", id],
    queryFn: () => requestJson<Supplier>("GET", `/api/suppliers/${id}`),
    enabled: Number.isFinite(id) && id > 0,
  });

  if (!parsed.ok) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <h1 className="text-lg font-semibold text-foreground">Supplier not found or invalid route</h1>
        <p className="text-sm text-muted-foreground">
          The link may be wrong, or the supplier id in the URL is missing or not a positive number. Use the procurement
          suppliers list to open a valid profile.
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          Expected path: {SUPPLIER_DETAIL_ROUTE_PATTERN.replace(":id", "<id>")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          onClick={() => setLocation(APP_ROUTES.procurement.suppliers)}
        >
          Back to suppliers
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6" data-testid="supplier-detail-page">
      <PageHeader
        title={isLoading ? "Supplier" : data?.name ?? "Supplier"}
        description="Read-only profile. Use the suppliers list for edits."
        breadcrumb={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setLocation(APP_ROUTES.procurement.suppliers)}
          >
            <ArrowLeft className="h-4 w-4" />
            Suppliers
          </button>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLocation(APP_ROUTES.procurement.suppliers)}
          >
            Back to list
          </Button>
        }
      />

      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : isError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Could not load supplier</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Contact:</span> {data.contactName ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span> {data.email ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Phone:</span> {data.phone ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Address:</span> {data.address ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Tax ID:</span> {data.taxIdentificationNumber ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Default currency:</span> {data.defaultCurrencyCode ?? "-"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
