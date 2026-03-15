import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";

type BaseMasterRecord = {
  id: number;
  code: string;
  name: string;
};

const MASTER_ENDPOINTS = {
  units: "/api/units-of-measure",
  currencies: "/api/currencies",
  taxCodes: "/api/tax-codes",
  commodityCodes: "/api/commodity-codes",
  incoterms: "/api/incoterms",
  paymentTerms: "/api/payment-terms",
  departments: "/api/departments",
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

  const { data = [], isLoading } = useQuery({
    queryKey: [endpoint],
    queryFn: () => requestJson<BaseMasterRecord[]>("GET", endpoint),
  });

  const createRecord = useMutation({
    mutationFn: (payload: Record<string, unknown>) => requestJson("POST", endpoint, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      setCode("");
      setName("");
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

  const deleteRecord = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `${endpoint}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
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
          className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim() || !name.trim()) {
              toast({ title: "Code and name are required", variant: "destructive" });
              return;
            }
            createRecord.mutate({ code: code.trim(), name: name.trim() });
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
          <div className="flex items-end">
            <Button type="submit" disabled={createRecord.isPending}>
              Add
            </Button>
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
                    <div className="text-xs text-muted-foreground">{row.name}</div>
                  </div>
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

export default function MasterDataPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Master Data"
        subtitle="Maintain shared reference data for procurement and finance."
      />
      <Tabs defaultValue="units" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="currencies">Currencies</TabsTrigger>
          <TabsTrigger value="taxCodes">Tax Codes</TabsTrigger>
          <TabsTrigger value="commodityCodes">Commodity Codes</TabsTrigger>
          <TabsTrigger value="incoterms">Incoterms</TabsTrigger>
          <TabsTrigger value="paymentTerms">Payment Terms</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
