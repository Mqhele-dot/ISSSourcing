import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { requestJson } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Warehouse } from "@/pages/warehouses/warehouse-types";

export default function WarehouseDetailPage() {
  const [, params] = useRoute<{ id: string }>("/warehouses/:id");
  const id = params?.id ? parseInt(params.id, 10) : NaN;

  const { data: raw, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/warehouses", id],
    queryFn: () => requestJson<Warehouse>("GET", `/api/warehouses/${id}`),
    enabled: Number.isFinite(id) && id > 0,
  });

  const data = raw;

  if (!Number.isFinite(id) || id <= 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-muted-foreground">Invalid warehouse.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/warehouses">Back to warehouses</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <PageHeader
        title={isLoading ? "Warehouse" : data?.name ?? "Warehouse"}
        description="Read-only configuration — use the list to edit."
        breadcrumb={
          <Link href="/warehouses" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
            <ArrowLeft className="h-4 w-4" />
            Warehouses
          </Link>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/warehouses">Back to list</Link>
          </Button>
        }
      />

      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : isError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Could not load warehouse</CardTitle>
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
            <CardTitle>Location</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Location:</span> {data.location ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Address:</span> {data.address ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Contact:</span>{" "}
              {[data.contactPerson, data.contactPhone].filter(Boolean).join(" · ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Default:</span> {data.isDefault ? "Yes" : "No"}
            </p>
            <p>
              <span className="text-muted-foreground">Aisles:</span>{" "}
              {Array.isArray(data.aisles) && data.aisles.length ? data.aisles.join(", ") : "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Bins:</span>{" "}
              {Array.isArray(data.bins) && data.bins.length
                ? data.bins.map((b) => b.code).join(", ")
                : "—"}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
