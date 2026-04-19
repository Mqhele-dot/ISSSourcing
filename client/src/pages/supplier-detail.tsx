import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { requestJson } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_ROUTES } from "@/lib/routes/app-routes";

/** Canonical procurement detail path (must match router). */
const SUPPLIER_DETAIL_PATTERN = "/procurement/suppliers/:id";

export default function SupplierDetailPage() {
  const [, params] = useRoute<{ id: string }>(SUPPLIER_DETAIL_PATTERN);
  const id = params?.id ? parseInt(params.id, 10) : NaN;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/suppliers", id],
    queryFn: () => requestJson<Supplier>("GET", `/api/suppliers/${id}`),
    enabled: Number.isFinite(id) && id > 0,
  });

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-muted-foreground">Invalid supplier.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={APP_ROUTES.procurement.suppliers}>Back to suppliers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <PageHeader
        title={isLoading ? "Supplier" : data?.name ?? "Supplier"}
        description="Read-only profile — use the list to edit."
        breadcrumb={
          <Link href={APP_ROUTES.procurement.suppliers} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Suppliers
          </Link>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={APP_ROUTES.procurement.suppliers}>Back to list</Link>
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
              <span className="text-muted-foreground">Contact:</span> {data.contactName ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span> {data.email ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Phone:</span> {data.phone ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Address:</span> {data.address ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Tax ID:</span> {data.taxIdentificationNumber ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Default currency:</span> {data.defaultCurrencyCode ?? "—"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
