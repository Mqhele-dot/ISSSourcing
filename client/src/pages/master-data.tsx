import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  Coins,
  Globe2,
  Percent,
  Ruler,
  ShieldCheck,
  Tags,
  Truck,
  Wallet,
  Package,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES, MASTER_DATA_SECTION_SLUGS, asSectionSlug } from "@/lib/routes/app-routes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageDataState } from "@/components/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { WarehouseTable } from "@/pages/warehouses/warehouse-table";
import { WarehouseDialogs } from "@/pages/warehouses/warehouse-dialogs";
import { useWarehouseCrud } from "@/pages/warehouses/use-warehouse-crud";

import { invalidateMasterDataDomainForEndpoint } from "@/lib/domain-invalidation";

type BaseMasterRecord = {
  id: number;
  code: string;
  name: string;
  symbol?: string | null;
};

const MASTER_ENDPOINTS = {
  units: "/api/units-of-measure",
  currencies: "/api/currencies",
  taxCodes: "/api/tax-codes",
  commodityCodes: "/api/commodity-codes",
  incoterms: "/api/incoterms",
  paymentTerms: "/api/payment-terms",
  departments: "/api/departments",
  warehouses: "/api/warehouses",
  carriers: "/api/carriers",
} as const;

function MasterTable({
  label,
  endpoint,
}: {
  label: string;
  endpoint: string;
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const isCurrencyEndpoint = endpoint === MASTER_ENDPOINTS.currencies;

  const { data = [], isLoading } = useQuery({
    queryKey: [endpoint],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", endpoint);
      return normalizeApiList<BaseMasterRecord>(raw);
    },
  });

  const createRecord = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson("POST", endpoint, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      setCode("");
      setName("");
      setSymbol("");
      toast({ title: `${label} created` });
    },
    onError: (e) => {
      toast({
        title: `Failed to create ${label.toLowerCase()}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const updateRecord = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      requestJson("PATCH", `${endpoint}/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      setEditingId(null);
      setCode("");
      setName("");
      setSymbol("");
      toast({ title: `${label} updated` });
    },
    onError: (e) => {
      toast({
        title: `Failed to update ${label.toLowerCase()}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const deleteRecord = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `${endpoint}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      void invalidateMasterDataDomainForEndpoint(queryClient, endpoint);
      toast({ title: `${label} removed` });
    },
    onError: (e) => {
      toast({
        title: `Failed to delete ${label.toLowerCase()}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const sorted = useMemo(
    () => [...data].sort((a, b) => a.code.localeCompare(b.code)),
    [data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className={`grid gap-2 ${isCurrencyEndpoint ? "md:grid-cols-[1fr_1fr_1fr_auto]" : "md:grid-cols-[1fr_1fr_auto]"}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim() || !name.trim()) {
              toast({ title: "Code and name are required", variant: "destructive" });
              return;
            }
            const currencySymbol =
              isCurrencyEndpoint && symbol.trim()
                ? symbol.trim()
                : isCurrencyEndpoint
                  ? code.trim().slice(0, 3) || "$"
                  : "";
            const payload = {
              code: code.trim(),
              name: name.trim(),
              ...(isCurrencyEndpoint ? { symbol: currencySymbol, decimalPlaces: 2 } : {}),
            };
            if (editingId != null) {
              updateRecord.mutate({ id: editingId, payload });
            } else {
              createRecord.mutate(payload);
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${endpoint}-code`}>Code</Label>
            <Input id={`${endpoint}-code`} value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${endpoint}-name`}>Name</Label>
            <Input id={`${endpoint}-name`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {isCurrencyEndpoint ? (
            <div className="space-y-1">
              <Label htmlFor={`${endpoint}-symbol`}>Symbol</Label>
              <Input
                id={`${endpoint}-symbol`}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="$"
              />
            </div>
          ) : null}
          <div className="flex items-end">
            <div className="flex gap-2">
              {editingId != null ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingId(null);
                      setCode("");
                      setName("");
                      setSymbol("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updateRecord.isPending}>
                    Save
                  </Button>
                </>
              ) : (
                <Button type="submit" disabled={createRecord.isPending}>
                  Add
                </Button>
              )}
            </div>
          </div>
        </form>

        <div className="rounded-md border">
          {isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">Loading...</div>
          ) : sorted.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No records yet.</div>
          ) : (
            <div className="divide-y">
              {sorted.map((row) => (
                <div key={row.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-sm font-medium">{row.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.name}
                      {isCurrencyEndpoint && row.symbol ? ` (${row.symbol})` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(row.id);
                      setCode(row.code);
                      setName(row.name);
                      setSymbol(row.symbol ?? "");
                    }}
                    disabled={updateRecord.isPending || deleteRecord.isPending}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteRecord.mutate(row.id)}
                    disabled={deleteRecord.isPending}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function WarehouseMasterPanel() {
  const crud = useWarehouseCrud();
  const [createWarehouseFormVariant, setCreateWarehouseFormVariant] = useState<"quick" | "full">("quick");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Warehouses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Warehouse setup belongs here: locations, addresses, contacts, aisles, bins, and layout metadata.
            Movement, storage, receiving, counts, and transfers belong in Warehouse Operations.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                crud.resetForm();
                setCreateWarehouseFormVariant("quick");
                crud.setIsCreateDialogOpen(true);
              }}
            >
              Quick add
            </Button>
            <Button
              type="button"
              onClick={() => {
                crud.resetForm();
                setCreateWarehouseFormVariant("full");
                crud.setIsCreateDialogOpen(true);
              }}
            >
              Add full setup
            </Button>
          </div>
        </div>

        <PageDataState
          isLoading={crud.isLoading}
          error={crud.isError ? (crud.error instanceof Error ? crud.error : new Error(String(crud.error))) : null}
          isEmpty={!crud.isLoading && !crud.isError && crud.list.length === 0}
          errorTitle="Failed to load warehouses"
          onRetry={() => crud.refetch()}
          emptyView={<div className="rounded-md border p-4 text-sm text-muted-foreground">No warehouses yet.</div>}
        >
          <WarehouseTable list={crud.list} onEdit={crud.openEditDialog} onDelete={crud.openDeleteDialog} />
        </PageDataState>

        <WarehouseDialogs
          isCreateDialogOpen={crud.isCreateDialogOpen}
          setIsCreateDialogOpen={crud.setIsCreateDialogOpen}
          createFormVariant={createWarehouseFormVariant}
          setCreateFormVariant={setCreateWarehouseFormVariant}
          isEditDialogOpen={crud.isEditDialogOpen}
          setIsEditDialogOpen={crud.setIsEditDialogOpen}
          isDeleteDialogOpen={crud.isDeleteDialogOpen}
          setIsDeleteDialogOpen={crud.setIsDeleteDialogOpen}
          formData={crud.formData}
          setFormData={crud.setFormData}
          selectedWarehouse={crud.selectedWarehouse}
          createWarehouse={crud.createWarehouse}
          updateWarehouse={crud.updateWarehouse}
          deleteWarehouse={crud.deleteWarehouse}
          addBin={crud.addBin}
          updateBin={crud.updateBin}
          removeBin={crud.removeBin}
          handleCreateSubmit={crud.handleCreateSubmit}
          handleEditSubmit={crud.handleEditSubmit}
          handleDeleteConfirm={crud.handleDeleteConfirm}
        />
      </CardContent>
    </Card>
  );
}
function ApprovalPoliciesRedirectCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval policies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Approval rules are managed on the dedicated <strong>Approval policies</strong> page (create, edit, levels, and
          approvers).
        </p>
        <Button asChild variant="default">
          <Link href={APP_ROUTES.finance.approvalPolicies}>Open approval policies</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function MasterDataPage() {
  const [location, setLocation] = useLocation();
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const activeSection = asSectionSlug(location.split("/")[3], MASTER_DATA_SECTION_SLUGS, "units");
  useEffect(() => {
    if (!isLgUp) {
      setLocation("/m/home");
    }
  }, [isLgUp, setLocation]);

  if (!isLgUp) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        Master data is available on large screens (1024px and wider). Use a desktop browser or resize the window. Sending you to the mobile hub…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6" data-testid="master-data-page">
      <PageHeader
        title="Master Data"
        subtitle="Maintain shared reference data for procurement and finance."
      />
      <Tabs
        value={activeSection}
        onValueChange={(value) => setLocation(APP_ROUTES.admin.masterDataSection(value as typeof activeSection))}
        className="space-y-4"
      >
        <TabsList className="flex h-auto flex-wrap gap-1 bg-muted/40 p-1">
          <TabsTrigger value="units" className="gap-1.5">
            <Ruler className="h-4 w-4 shrink-0" />
            Units
          </TabsTrigger>
          <TabsTrigger value="currencies" className="gap-1.5">
            <Coins className="h-4 w-4 shrink-0" />
            Currencies
          </TabsTrigger>
          <TabsTrigger value="taxCodes" className="gap-1.5">
            <Percent className="h-4 w-4 shrink-0" />
            Tax Codes
          </TabsTrigger>
          <TabsTrigger value="commodityCodes" className="gap-1.5">
            <Tags className="h-4 w-4 shrink-0" />
            Commodity Codes
          </TabsTrigger>
          <TabsTrigger value="incoterms" className="gap-1.5">
            <Globe2 className="h-4 w-4 shrink-0" />
            Incoterms
          </TabsTrigger>
          <TabsTrigger value="paymentTerms" className="gap-1.5">
            <Wallet className="h-4 w-4 shrink-0" />
            Payment Terms
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-1.5">
            <Building2 className="h-4 w-4 shrink-0" />
            Departments
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-1.5">
            <Package className="h-4 w-4 shrink-0" />
            Warehouses
          </TabsTrigger>
          <TabsTrigger value="carriers" className="gap-1.5">
            <Truck className="h-4 w-4 shrink-0" />
            Carriers
          </TabsTrigger>
          <TabsTrigger value="approvalPolicies" className="gap-1.5">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Approval Policies
          </TabsTrigger>
        </TabsList>
        <TabsContent value="units">
          <MasterTable label="Units of Measure" endpoint={MASTER_ENDPOINTS.units} />
        </TabsContent>
        <TabsContent value="currencies">
          <MasterTable label="Currencies" endpoint={MASTER_ENDPOINTS.currencies} />
        </TabsContent>
        <TabsContent value="taxCodes">
          <MasterTable label="Tax Codes" endpoint={MASTER_ENDPOINTS.taxCodes} />
        </TabsContent>
        <TabsContent value="commodityCodes">
          <MasterTable label="Commodity Codes" endpoint={MASTER_ENDPOINTS.commodityCodes} />
        </TabsContent>
        <TabsContent value="incoterms">
          <MasterTable label="Incoterms" endpoint={MASTER_ENDPOINTS.incoterms} />
        </TabsContent>
        <TabsContent value="paymentTerms">
          <MasterTable label="Payment Terms" endpoint={MASTER_ENDPOINTS.paymentTerms} />
        </TabsContent>
        <TabsContent value="departments">
          <MasterTable label="Departments" endpoint={MASTER_ENDPOINTS.departments} />
        </TabsContent>
        <TabsContent value="warehouses">
          <WarehouseMasterPanel />
        </TabsContent>
        <TabsContent value="carriers">
          <MasterTable label="Carriers" endpoint={MASTER_ENDPOINTS.carriers} />
        </TabsContent>
        <TabsContent value="approvalPolicies">
          <ApprovalPoliciesRedirectCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
