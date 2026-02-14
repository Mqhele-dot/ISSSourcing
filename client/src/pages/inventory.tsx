import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";
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

function downloadCsv(filename: string, rows: string[][]) {
  const escaped = rows.map((row) =>
    row
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(","),
  );
  const csv = escaped.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export default function InventoryPage() {
  const [, setLocation] = useLocation();
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

  const categoriesFetcher = useCallback(async (): Promise<Category[]> => {
    const response = await fetch("/api/categories", { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Failed to fetch categories (${response.status})`);
    }
    return (await response.json()) as Category[];
  }, []);

  const {
    loading: categoriesLoading,
    data: categoriesData,
  } = useAsyncResource(categoriesFetcher);

  const categories = categoriesData ?? EMPTY_CATEGORIES;
  const selectedLocation = String(queryState.location || "");
  const selectedCategory = String(queryState.category || "");

  const handleExportCsv = () => {
    const items = inventoryData ?? [];
    const rows: string[][] = [
      ["sku", "name", "location", "on_hand", "allocated", "available", "updated_at"],
      ...items.map((item) => [
        item.sku,
        item.name,
        item.location || "",
        String(item.onHand),
        String(item.allocated),
        String(item.available),
        item.updatedAt || "",
      ]),
    ];
    downloadCsv("inventory-export.csv", rows);
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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Inventory"
        subtitle="Operational inventory overview"
        description="Track on-hand, allocated, and available stock with location-aware filtering."
        icon={<Boxes className="h-6 w-6 text-primary" />}
        breadcrumb={<span>Operations / Inventory</span>}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={!inventoryData || inventoryData.length === 0}
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
            <div className="relative w-full min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={String(queryState.q || "")}
                onChange={(event) => setQueryState({ q: event.target.value })}
                placeholder="Search SKU or item name"
                className="pl-8"
              />
            </div>

            <Select
              value={selectedLocation || "all"}
              onValueChange={(value) => setQueryState({ location: value === "all" ? "" : value })}
            >
              <SelectTrigger className="w-[180px]">
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
              <SelectTrigger className="w-[180px]">
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
        }
      />

      <DataState
        loading={inventoryLoading}
        error={inventoryError}
        data={inventoryData}
        isEmpty={(items) => items.length === 0}
        emptyTitle="No inventory items found"
        emptyDescription="Try broadening your filters or reset search criteria."
        onRetry={refetchInventory}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.sku}
                  className="cursor-pointer"
                  onClick={() => setLocation(`/inventory/${item.sku}`)}
                >
                  <TableCell className="font-medium">{item.sku}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{item.location || "Unassigned"}</TableCell>
                  <TableCell className="text-right">{item.onHand}</TableCell>
                  <TableCell className="text-right">{item.allocated}</TableCell>
                  <TableCell className="text-right">{item.available}</TableCell>
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
        )}
      </DataState>
    </div>
  );
}
