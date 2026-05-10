import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Boxes, Download, ExternalLink, Eye, LayoutGrid, List, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { useQueryState } from "@/hooks/use-query-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";
import { downloadCsv } from "@/lib/csv-download";
import { isLikelyCsvResponse, parseExportFailureMessage } from "@/lib/export-download";
import { fetchInventory } from "@/api/client";
import type { InventoryListItem } from "@/api/types";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { getInventoryAvailabilityStatus } from "@shared/functional-calculations";

type Category = {
  id: number;
  name: string;
};

const EMPTY_CATEGORIES: Category[] = [];

type InventorySort = "name-asc" | "sku-asc" | "available-asc" | "available-desc" | "updated-desc" | "updated-asc";
type InventoryViewMode = "table" | "cards";

function isLowFilterEnabled(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function formatUpdated(value: InventoryListItem["updatedAt"]): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function updatedTime(value: InventoryListItem["updatedAt"]): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function inventoryStatus(item: InventoryListItem): "error" | "low" | "active" {
  const status = getInventoryAvailabilityStatus(item.available, item.lowStockThreshold);
  return status === "error" || status === "low" ? status : "active";
}

function inventoryStatusExplanation(item: InventoryListItem): string {
  const status = inventoryStatus(item);
  if (status === "error") {
    return "Allocated stock is higher than on-hand stock. Check reservations, picks, or recent adjustments.";
  }
  if (status === "low") {
    return "This item is at or below its reorder threshold.";
  }
  return "This item currently has availability above threshold.";
}

function recommendedInventoryAction(item: InventoryListItem): string {
  const status = inventoryStatus(item);
  if (status === "error") return "Review reservations and recent stock movements before promising more stock.";
  if (status === "low") return "Create or review a reorder request for replenishment.";
  return "No immediate stock action is needed.";
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
  const [sortBy, setSortBy] = useState<InventorySort>("name-asc");
  const [viewMode, setViewMode] = useState<InventoryViewMode>("table");
  const [previewItem, setPreviewItem] = useState<InventoryListItem | null>(null);

  const [searchInput, setSearchInput] = useState(String(queryState.q ?? ""));
  useEffect(() => {
    setSearchInput(String(queryState.q ?? ""));
  }, [queryState.q]);
  useEffect(() => {
    const next = String(searchInput ?? "").trim();
    const current = String(queryState.q ?? "");
    if (next === current) return;
    const handle = window.setTimeout(() => {
      setQueryState({ q: next });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [queryState.q, searchInput, setQueryState]);

  const [locationFilter, setLocationFilter] = useState(String(queryState.location || ""));
  useEffect(() => {
    setLocationFilter(String(queryState.location || ""));
  }, [queryState.location]);

  const [categoryFilter, setCategoryFilter] = useState(String(queryState.category || ""));
  useEffect(() => {
    setCategoryFilter(String(queryState.category || ""));
  }, [queryState.category]);

  const [lowFilter, setLowFilter] = useState(String(queryState.low || ""));
  useEffect(() => {
    setLowFilter(String(queryState.low || ""));
  }, [queryState.low]);

  const inventoryFetcher = useCallback(async () => {
    const lowEnabled = isLowFilterEnabled(String(queryState.low || ""));
    return fetchInventory({
      q: String(queryState.q ?? "").trim(),
      location: String(queryState.location || "").trim(),
      category: String(queryState.category || "").trim(),
      lowStock: lowEnabled,
    });
  }, [queryState.category, queryState.location, queryState.low, queryState.q]);

  const {
    loading: inventoryLoading,
    error: inventoryError,
    data: inventoryData,
    refetch: refetchInventory,
  } = useAsyncResource(inventoryFetcher);

  const warehousesFetcher = useCallback((): Promise<Array<{ id: number; name: string }>> => {
    return requestJson<Array<{ id: number; name: string }>>("GET", "/api/warehouses");
  }, []);

  const {
    loading: warehousesLoading,
    data: warehousesData,
    error: warehousesError,
    refetch: refetchWarehouses,
  } = useAsyncResource(warehousesFetcher);

  const warehouses = warehousesData ?? [];

  const categoriesFetcher = useCallback((): Promise<Category[]> => {
    return requestJson<Category[]>("GET", "/api/categories");
  }, []);

  const {
    loading: categoriesLoading,
    data: categoriesData,
    error: categoriesError,
    refetch: refetchCategories,
  } = useAsyncResource(categoriesFetcher);

  const categories = categoriesData ?? EMPTY_CATEGORIES;
  const categoryNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const category of categories) map.set(category.id, category.name);
    return map;
  }, [categories]);
  const categoryNameFor = useCallback(
    (item: InventoryListItem) =>
      typeof item.categoryId === "number" ? categoryNameById.get(item.categoryId) ?? "Uncategorised" : "Uncategorised",
    [categoryNameById],
  );

  const runClientCsv = useCallback(() => {
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
        item.updatedAt ? (typeof item.updatedAt === "string" ? item.updatedAt : new Date(item.updatedAt).toISOString()) : "",
      ]),
    ];
    downloadCsv("inventory-export.csv", rows);
    toast({ title: "Export complete", description: "inventory-export.csv downloaded." });
  }, [inventoryData, toast]);

  const runServerCsv = useCallback(async () => {
    const lowEnabled = isLowFilterEnabled(String(queryState.low || ""));
    const params = new URLSearchParams();
    const q = String(queryState.q ?? "").trim();
    const loc = String(queryState.location || "").trim();
    const cat = String(queryState.category || "").trim();
    if (q) params.set("q", q);
    if (loc) params.set("location", loc);
    if (cat) params.set("category", cat);
    if (lowEnabled) params.set("lowStock", "true");
    const qs = params.toString();
    const url = `/api/export/inventory/csv${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      const detail = await parseExportFailureMessage(res);
      if (res.status === 403) {
        throw new Error(
          "You do not have permission to export reports. Ask an admin for the reports export permission.",
        );
      }
      if (res.status === 400 && /invalid|feature|disabled/i.test(detail)) {
        throw new Error(detail);
      }
      throw new Error(detail || `Server export failed (${res.status})`);
    }
    if (!isLikelyCsvResponse(res)) {
      const detail = await parseExportFailureMessage(res);
      throw new Error(detail || "Server did not return a CSV file. Exports may be disabled for this organization.");
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
    toast({ title: "Export complete", description: "Downloaded server inventory CSV (matches current filters)." });
  }, [toast, queryState.category, queryState.location, queryState.low, queryState.q]);

  const handleExportCsv = () => {
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

  const handleExportServerCsvDev = () => {
    void (async () => {
      try {
        await runServerCsv();
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
    for (const w of warehouses) {
      if (w.name?.trim()) locationSet.add(w.name.trim());
    }
    for (const item of inventoryData ?? []) {
      if (item.location) {
        locationSet.add(item.location);
      }
    }
    return Array.from(locationSet).sort((a, b) => a.localeCompare(b));
  }, [warehouses, inventoryData]);

  const clearFilters = () => {
    setSearchInput("");
    setLocationFilter("");
    setCategoryFilter("");
    setLowFilter("");
    setQueryState({ q: "", location: "", category: "", low: "" });
  };

  const activeSearch = String(searchInput || "").trim();
  const activeLocation = String(locationFilter || "").trim();
  const activeCategory = String(categoryFilter || "").trim();
  const activeLow = isLowFilterEnabled(String(lowFilter || ""));
  const displayedItems = useMemo(() => {
    const search = activeSearch.toLowerCase();
    const location = activeLocation.toLowerCase();
    const category = activeCategory.toLowerCase();
    return (inventoryData ?? []).filter((item) => {
      if (search && !`${item.sku} ${item.name}`.toLowerCase().includes(search)) return false;
      if (location && String(item.location || "").toLowerCase() !== location) return false;
      if (category) {
        const categoryMatchesId = String(item.categoryId ?? "").toLowerCase() === category;
        const categoryMatchesName = categoryNameFor(item).toLowerCase() === category;
        if (!categoryMatchesId && !categoryMatchesName) return false;
      }
      if (activeLow && Number(item.available) > Number(item.lowStockThreshold)) return false;
      return true;
    });
  }, [activeCategory, activeLocation, activeLow, activeSearch, categoryNameFor, inventoryData]);
  const hasActiveFilters = Boolean(activeSearch || activeLocation || activeCategory || activeLow);
  const activeCategoryName =
    activeCategory && Number.isFinite(Number(activeCategory))
      ? categoryNameById.get(Number(activeCategory)) ?? activeCategory
      : activeCategory;
  const sortedItems = useMemo(() => {
    return [...displayedItems].sort((a, b) => {
      if (sortBy === "sku-asc") return a.sku.localeCompare(b.sku);
      if (sortBy === "available-asc") return Number(a.available) - Number(b.available);
      if (sortBy === "available-desc") return Number(b.available) - Number(a.available);
      if (sortBy === "updated-desc") return updatedTime(b.updatedAt) - updatedTime(a.updatedAt);
      if (sortBy === "updated-asc") return updatedTime(a.updatedAt) - updatedTime(b.updatedAt);
      return a.name.localeCompare(b.name);
    });
  }, [displayedItems, sortBy]);
  const kpis = useMemo(
    () => ({
      totalSkus: displayedItems.length,
      lowStock: displayedItems.filter((item) => inventoryStatus(item) === "low").length,
      negativeAvailability: displayedItems.filter((item) => Number(item.available) < 0).length,
      totalOnHand: displayedItems.reduce((sum, item) => sum + Number(item.onHand || 0), 0),
      totalAllocated: displayedItems.reduce((sum, item) => sum + Number(item.allocated || 0), 0),
      totalAvailable: displayedItems.reduce((sum, item) => sum + Number(item.available || 0), 0),
    }),
    [displayedItems],
  );
  const clearFilter = (key: "q" | "location" | "category" | "low") => {
    if (key === "q") setSearchInput("");
    if (key === "location") setLocationFilter("");
    if (key === "category") setCategoryFilter("");
    if (key === "low") setLowFilter("");
    setQueryState({ [key]: "" });
  };
  const openFullItem = (sku: string) => {
    setLocation(APP_ROUTES.inventory.item(sku));
  };

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4" data-testid="inventory-page">
      <PageHeader
        title="Inventory"
        titleTestId="page-title"
        subtitle="Operational inventory overview"
        description="Track on-hand, allocated, and available stock with location-aware filtering."
        icon={<Boxes className="h-6 w-6 text-primary" />}
        breadcrumb={<span>Inventory / Overview</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={import.meta.env.DEV && displayedItems.length === 0}
              className="gap-2"
              data-testid="inventory-export-button"
            >
              <Download className="h-4 w-4" />
              {import.meta.env.DEV ? "Export CSV (browser — visible rows)" : "Export CSV (matches filters)"}
            </Button>
            {import.meta.env.DEV ? (
              <Button variant="outline" size="sm" onClick={handleExportServerCsvDev} className="gap-2">
                Server CSV
              </Button>
            ) : null}
            <Button variant="outline" onClick={refetchInventory} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <ModuleTrainingPanel moduleId="inventory" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card data-testid="inventory-kpi-total-skus">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total SKUs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{kpis.totalSkus}</CardContent>
        </Card>
        <Card data-testid="inventory-kpi-low-stock">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Low stock</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{kpis.lowStock}</CardContent>
        </Card>
        <Card data-testid="inventory-kpi-negative-availability">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Negative availability</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{kpis.negativeAvailability}</CardContent>
        </Card>
        <Card data-testid="inventory-kpi-total-on-hand">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total on hand</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{kpis.totalOnHand}</CardContent>
        </Card>
        <Card data-testid="inventory-kpi-total-allocated">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total allocated</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{kpis.totalAllocated}</CardContent>
        </Card>
        <Card data-testid="inventory-kpi-total-available">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total available</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{kpis.totalAvailable}</CardContent>
        </Card>
      </div>

      {categoriesError ? (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <AlertTitle>Category filter unavailable</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              The inventory table still loads; only the category dropdown failed (
              {categoriesError.message || "unknown error"}).
            </span>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchCategories()}>
              Retry categories
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {warehousesError ? (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100">
          <AlertTitle>Warehouse names unavailable for location filter</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>
              Location dropdown still includes values from the current result set. Warehouse list failed to load (
              {warehousesError.message || "unknown error"}).
            </span>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void refetchWarehouses()}>
              Retry warehouses
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Toolbar
        sticky
        left={
          <>
            <div className="relative w-full min-w-0 sm:min-w-[220px] sm:max-w-sm" data-tour="inventory-search">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="inventory-search-input"
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                }}
                placeholder="Search SKU or item name"
                className="pl-8"
              />
            </div>

            <Select
              value={locationFilter || "all"}
              onValueChange={(value) => {
                const v = value === "all" ? "" : value;
                setLocationFilter(v);
                setQueryState({ location: v });
              }}
              disabled={warehousesLoading}
            >
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="inventory-location-filter">
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
              value={categoryFilter || "all"}
              onValueChange={(value) => {
                const v = value === "all" ? "" : value;
                setCategoryFilter(v);
                setQueryState({ category: v });
              }}
              disabled={categoriesLoading}
            >
              <SelectTrigger className="w-full sm:w-[180px]" data-testid="inventory-category-filter">
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
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as InventorySort)}>
              <SelectTrigger className="w-full sm:w-[190px]" data-testid="inventory-sort-select">
                <SelectValue placeholder="Sort inventory" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Name A-Z</SelectItem>
                <SelectItem value="sku-asc">SKU A-Z</SelectItem>
                <SelectItem value="available-asc">Available low to high</SelectItem>
                <SelectItem value="available-desc">Available high to low</SelectItem>
                <SelectItem value="updated-desc">Updated newest</SelectItem>
                <SelectItem value="updated-asc">Updated oldest</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-md border p-1">
              <Button
                type="button"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("table")}
                data-testid="inventory-view-table-button"
                className="gap-1"
              >
                <List className="h-4 w-4" />
                Table
              </Button>
              <Button
                type="button"
                variant={viewMode === "cards" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("cards")}
                data-testid="inventory-view-cards-button"
                className="gap-1"
              >
                <LayoutGrid className="h-4 w-4" />
                Cards
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
            <span data-tour="inventory-low-toggle">
              <Button
                data-testid="inventory-low-stock-filter"
                variant={isLowFilterEnabled(lowFilter) ? "default" : "outline"}
                onClick={() => {
                  const next = isLowFilterEnabled(lowFilter) ? "" : "1";
                  setLowFilter(next);
                  setQueryState({ low: next });
                }}
              >
                Low stock only
              </Button>
            </span>
          </div>
        }
      />

      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="inventory-active-filters">
          <span className="text-muted-foreground">Active filters:</span>
          {activeSearch ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => clearFilter("q")}
              data-testid="inventory-filter-chip-search"
              className="gap-1"
            >
              Search: {activeSearch}
              <X className="h-3 w-3" />
            </Button>
          ) : null}
          {activeLocation ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => clearFilter("location")}
              data-testid="inventory-filter-chip-location"
              className="gap-1"
            >
              Location: {activeLocation}
              <X className="h-3 w-3" />
            </Button>
          ) : null}
          {activeCategory ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => clearFilter("category")}
              data-testid="inventory-filter-chip-category"
              className="gap-1"
            >
              Category: {activeCategoryName}
              <X className="h-3 w-3" />
            </Button>
          ) : null}
          {activeLow ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => clearFilter("low")}
              data-testid="inventory-filter-chip-low-stock"
              className="gap-1"
            >
              Low stock only
              <X className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <DataState
        loading={inventoryLoading}
        error={inventoryError}
        data={sortedItems}
        isEmpty={(items) => items.length === 0}
        emptyTitle="No inventory items found"
        emptyDescription="No inventory items match your filters. Inventory records show what stock exists, where it sits, and when to reorder—without them, teams oversell, duplicate buys, or miss shortages."
        emptyAction={
          <div className="space-y-3">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Inventory item creation is not available from this screen yet. Use Master Data, imports, or setup tools.
            </p>
            <div className="flex flex-wrap gap-2">
            {hasActiveFilters ? (
              <Button type="button" variant="default" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={APP_ROUTES.admin.masterData}>Go to Master Data</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={APP_ROUTES.inventory.reorder}>Go to Reorder Requests</Link>
            </Button>
            </div>
          </div>
        }
        onRetry={refetchInventory}
      >
        {(items) => (
          viewMode === "cards" ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <Card
                  key={item.sku}
                  data-testid={`inventory-card-${item.sku}`}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onClick={() => setPreviewItem(item)}
                >
                  <CardHeader className="space-y-1 pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{item.name}</CardTitle>
                        <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
                      </div>
                      <span data-testid={`inventory-status-${item.sku}`}>
                        <StatusBadge status={inventoryStatus(item)} />
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Location</span>
                      <span>{item.location || "Unassigned"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Category</span>
                      <span>{categoryNameFor(item)}</span>
                    </div>
                    <div
                      className="grid grid-cols-3 gap-2 rounded-md border p-3 text-center tabular-nums"
                      data-on-hand={item.onHand}
                      data-allocated={item.allocated}
                      data-available={item.available}
                    >
                      <div>
                        <div className="text-xs text-muted-foreground">On hand</div>
                        <div className="font-semibold">{item.onHand}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Allocated</div>
                        <div className="font-semibold">{item.allocated}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Available</div>
                        <div className="font-semibold">{item.available}</div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid={`inventory-row-preview-${item.sku}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewItem(item);
                        }}
                      >
                        Preview
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        data-testid={`inventory-row-open-${item.sku}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openFullItem(item.sku);
                        }}
                      >
                        Open
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
          <div data-testid="inventory-table" data-tour="inventory-table" className="overflow-x-auto">
          <Table className="table-fixed w-full min-w-[64rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22%]">Item</TableHead>
                <TableHead className="w-[13%]">Location</TableHead>
                <TableHead className="w-[14%]">Category</TableHead>
                <TableHead className="w-[20%] text-right">
                  <span className="inline-flex flex-col items-end gap-0.5 tabular-nums">
                    <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      Stock position
                    </span>
                    <span>On hand / Alloc / Avail</span>
                  </span>
                </TableHead>
                <TableHead className="w-[10%] text-right">Threshold</TableHead>
                <TableHead className="w-[10%]">Status</TableHead>
                <TableHead className="w-[11%] text-right">Updated</TableHead>
                <TableHead className="w-[10%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow
                  key={item.sku}
                  data-testid={`inventory-row-${item.sku}`}
                  className="cursor-pointer"
                  onClick={() => setPreviewItem(item)}
                >
                  <TableCell className="align-top">
                    <div className="font-medium">{item.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{item.sku}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm">{item.location || "Unassigned"}</TableCell>
                  <TableCell className="align-top text-sm">{categoryNameFor(item)}</TableCell>
                  <TableCell
                    className="text-right align-top tabular-nums"
                    data-on-hand={item.onHand}
                    data-allocated={item.allocated}
                    data-available={item.available}
                  >
                    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5">
                      <span>{item.onHand}</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{item.allocated}</span>
                      <span className="text-muted-foreground">/</span>
                      <span>{item.available}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">{item.lowStockThreshold}</TableCell>
                  <TableCell data-testid={`inventory-status-${item.sku}`}>
                    <StatusBadge status={inventoryStatus(item)} />
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatUpdated(item.updatedAt)}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        data-testid={`inventory-row-preview-${item.sku}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewItem(item);
                        }}
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Preview {item.sku}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        data-testid={`inventory-row-open-${item.sku}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openFullItem(item.sku);
                        }}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Open {item.sku}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          )
        )}
      </DataState>

      <Dialog open={Boolean(previewItem)} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent data-testid="inventory-item-preview" className="sm:max-w-2xl">
          {previewItem ? (
            <>
              <DialogHeader>
                <DialogTitle data-testid="inventory-item-preview-title">{previewItem.name}</DialogTitle>
                <DialogDescription>SKU {previewItem.sku}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Location</div>
                  <div className="font-medium">{previewItem.location || "Unassigned"}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Category</div>
                  <div className="font-medium">{categoryNameFor(previewItem)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">On hand</div>
                  <div className="text-xl font-semibold tabular-nums">{previewItem.onHand}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Allocated</div>
                  <div className="text-xl font-semibold tabular-nums">{previewItem.allocated}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Available</div>
                  <div className="text-xl font-semibold tabular-nums">{previewItem.available}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Low stock threshold</div>
                  <div className="text-xl font-semibold tabular-nums">{previewItem.lowStockThreshold}</div>
                </div>
              </div>
              <Alert>
                <AlertTitle className="flex items-center gap-2" data-testid="inventory-item-preview-status">
                  <StatusBadge status={inventoryStatus(previewItem)} />
                  {inventoryStatus(previewItem) === "error"
                    ? "Negative availability"
                    : inventoryStatus(previewItem) === "low"
                      ? "Low stock"
                      : "Active"}
                </AlertTitle>
                <AlertDescription className="mt-2 space-y-2">
                  <p>{inventoryStatusExplanation(previewItem)}</p>
                  <p>
                    <span className="font-medium">Recommended next action:</span>{" "}
                    {recommendedInventoryAction(previewItem)}
                  </p>
                  <p className="text-xs text-muted-foreground">Updated {formatUpdated(previewItem.updatedAt)}</p>
                </AlertDescription>
              </Alert>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="inventory-item-preview-close"
                  onClick={() => setPreviewItem(null)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  data-testid="inventory-item-preview-open-full"
                  onClick={() => openFullItem(previewItem.sku)}
                >
                  Open full item page
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
