import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Can } from "@/components/auth/can";
import { Boxes, Download, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";
import { downloadCsv } from "@/lib/csv-download";
import { fetchInventory, type InventoryListItem } from "@/api/client";

type Category = {
  id: number;
  name: string;
};

const EMPTY_CATEGORIES: Category[] = [];

function getAvailabilityStatus(item: InventoryListItem): string {
  if (item.available < 0) {
    return "error";
  }
  if (item.available <= item.lowStockThreshold) {
    return "low";
  }
  return "active";
}

function isLowFilterEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

export default function InventoryPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { queryState, setQueryState } = useQueryState({
    q: "",
    location: "",
    category: "",
    low: "",
  });

  const inventoryFetcher = useCallback(async () => {
    const lowEnabled = isLowFilterEnabled(String(queryState.low || ""));
    return fetchInventory({
      q: String(queryState.q || ""),
      location: String(queryState.location || ""),
      category: String(queryState.category || ""),
      lowStock: lowEnabled,
    });
  }, [queryState.category, queryState.location, queryState.low, queryState.q]);

  const {
    loading: inventoryLoading,
    error: inventoryError,
    data: inventoryData,
    refetch: refetchInventory,
  } = useAsyncResource(inventoryFetcher);

  const categoriesFetcher = useCallback((): Promise<Category[]> => {
    return requestJson<Category[]>("GET", "/api/categories");
  }, []);

  const {
    loading: categoriesLoading,
    data: categoriesData,
  } = useAsyncResource(categoriesFetcher);

  const categories = categoriesData ?? EMPTY_CATEGORIES;
  const selectedLocation = String(queryState.location || "");
  const selectedCategory = String(queryState.category || "");

  const [searchInput, setSearchInput] = useState(String(queryState.q ?? ""));
  useEffect(() => {
    setSearchInput(String(queryState.q ?? ""));
  }, [queryState.q]);

  const handleExportCsv = () => {
    const runClientCsv = () => {
      const items = displayedItems;
      const rows: string[][] = [
        ["sku", "name", "location", "on_hand", "allocated", "available", "updated_at"],
        ...items.map((item) => [
          item.sku,
          item.name,
          item.location || "",
          String(item.onHand),
          String(item.allocated),
          String(item.available),
          item.updatedAt ? (typeof item.updatedAt === "string" ? item.updatedAt : new Date(item.updatedAt).toISOString()) : "",
        ]),
      ];
      downloadCsv("inventory-export.csv", rows);
      toast({ title: "Export complete", description: "inventory-export.csv downloaded." });
    };

    const runServerCsv = async () => {
      const res = await fetch("/api/export/inventory/csv", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Server export failed (${res.status})`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "inventory-report.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      toast({ title: "Export complete", description: "Downloaded server inventory CSV." });
    };

    void (async () => {
      try {
        if (import.meta.env.DEV) {
          runClientCsv();
        } else {
          await runServerCsv();
        }
      } catch (err) {
        toast({
          title: "Export failed",
          description: err instanceof Error ? err.message : "Failed to export CSV",
          variant: "destructive",
        });
      }
    })();
  };

  const knownLocations = useMemo(() => {
    const locationSet = new Set<string>();
    for (const item of inventoryData ?? []) {
      if (item.location) {
        locationSet.add(item.location);
      }
    }
    return Array.from(locationSet).sort((a, b) => a.localeCompare(b));
  }, [inventoryData]);

  const displayedItems = useMemo(() => {
    const base = inventoryData ?? [];
    const q = String(queryState.q || "").trim().toLowerCase();
    const location = String(queryState.location || "").trim().toLowerCase();
    const category = String(queryState.category || "").trim();
    const lowOnly = isLowFilterEnabled(String(queryState.low || ""));
    return base.filter((item) => {
      if (q) {
        const haystack = `${item.sku} ${item.name}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (location && (item.location || "").toLowerCase() !== location) {
        return false;
      }
      if (category && String(item.categoryId ?? "") !== category) {
        return false;
      }
      if (lowOnly && item.available > item.lowStockThreshold) {
        return false;
      }
      return true;
    });
  }, [inventoryData, queryState.category, queryState.location, queryState.low, queryState.q]);

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      <PageHeader
        title="Inventory"
        subtitle="Operational inventory overview"
        description="Track on-hand, allocated, and available stock with location-aware filtering."
        icon={<Boxes className="h-6 w-6 text-primary" />}
        breadcrumb={<span>Operations / Inventory</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={import.meta.env.DEV && displayedItems.length === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={refetchInventory} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <Toolbar
        sticky
        left={
          <>
            <div className="relative w-full min-w-0 sm:min-w-[220px] sm:max-w-sm" data-tour="inventory-search">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => {
                  const v = event.target.value;
                  setSearchInput(v);
                  setQueryState({ q: v });
                }}
                placeholder="Search SKU or item name"
                className="pl-8"
              />
            </div>

            <Select
              value={selectedLocation || "all"}
              onValueChange={(value) => setQueryState({ location: value === "all" ? "" : value })}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {knownLocations.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={selectedCategory || "all"}
              onValueChange={(value) => setQueryState({ category: value === "all" ? "" : value })}
              disabled={categoriesLoading}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        right={
          <span data-tour="inventory-low-toggle">
            <Button
              variant={isLowFilterEnabled(String(queryState.low || "")) ? "default" : "outline"}
              onClick={() =>
                setQueryState({
                  low: isLowFilterEnabled(String(queryState.low || "")) ? "" : "1",
                })
              }
            >
              Low stock only
            </Button>
          </span>
        }
      />

      <DataState
        loading={inventoryLoading}
        error={inventoryError}
        data={displayedItems}
        isEmpty={(items) => items.length === 0}
        emptyTitle="No inventory items found"
        emptyDescription="Add items from the dashboard or run the demo to seed data."
        emptyAction={
          <div className="flex flex-wrap gap-2">
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add inventory">
              <Button asChild variant="default" size="sm">
                <Link href="/dashboard">Add items (Dashboard)</Link>
              </Button>
            </Can>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Overview / Demo</Link>
            </Button>
          </div>
        }
        onRetry={refetchInventory}
      >
        {(items) => (
          <div data-tour="inventory-table" className="overflow-x-auto">
          <Table className="table-fixed w-full min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[10%]">SKU</TableHead>
                <TableHead className="w-[22%]">Name</TableHead>
                <TableHead className="w-[14%]">Location</TableHead>
                <TableHead className="w-[20%] text-right">
                  <span className="inline-flex flex-col items-end gap-0.5 tabular-nums">
                    <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      Stock
                    </span>
                    <span>On hand / Alloc / Avail</span>
                  </span>
                </TableHead>
                <TableHead className="w-[12%]">Status</TableHead>
                <TableHead className="w-[14%] text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.sku}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/inventory/${item.sku}`)}
                >
                  <TableCell className="font-medium align-top">{item.sku}</TableCell>
                  <TableCell className="align-top">{item.name}</TableCell>
                  <TableCell className="align-top text-sm">{item.location || "Unassigned"}</TableCell>
                  <TableCell className="text-right align-top tabular-nums">
                    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5">
                      <span>{item.onHand}</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{item.allocated}</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{item.available}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={getAvailabilityStatus(item)} />
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </DataState>
    </div>
  );
}
