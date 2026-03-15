import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";

type BaseMasterRecord = {
  id: number;
  code: string;
  name: string;
};

type ApprovalPolicy = {
  id: number;
  name: string;
  entityType: "requisition" | "purchase_order";
  amountMin: number;
  amountMax: number | null;
  approvalLevel: number;
  approverRole: string | null;
  approverUserId: number | null;
  isActive: boolean;
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
  const [editingId, setEditingId] = useState<number | null>(null);

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

  const updateRecord = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      requestJson("PATCH", `${endpoint}/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      setEditingId(null);
      setCode("");
      setName("");
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
            const payload = { code: code.trim(), name: name.trim() };
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
                    <div className="text-xs text-muted-foreground">{row.name}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(row.id);
                      setCode(row.code);
                      setName(row.name);
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

function ApprovalPoliciesTable() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState<"requisition" | "purchase_order">("requisition");
  const [amountMin, setAmountMin] = useState("0");
  const [amountMax, setAmountMax] = useState("");
  const [approvalLevel, setApprovalLevel] = useState("1");
  const [approverRole, setApproverRole] = useState("");
  const [approverUserId, setApproverUserId] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data = [], isLoading } = useQuery({
    queryKey: ["/api/approval-policies"],
    queryFn: () => requestJson<ApprovalPolicy[]>("GET", "/api/approval-policies"),
  });

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setEntityType("requisition");
    setAmountMin("0");
    setAmountMax("");
    setApprovalLevel("1");
    setApproverRole("");
    setApproverUserId("");
    setIsActive(true);
  };

  const toPayload = () => ({
    name: name.trim(),
    entityType,
    amountMin: Number(amountMin || 0),
    amountMax: amountMax.trim() ? Number(amountMax) : null,
    approvalLevel: Number(approvalLevel || 1),
    approverRole: approverRole.trim() || null,
    approverUserId: approverUserId.trim() ? Number(approverUserId) : null,
    isActive,
  });

  const createPolicy = useMutation({
    mutationFn: () => requestJson("POST", "/api/approval-policies", toPayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      toast({ title: "Approval policy created" });
      resetForm();
    },
    onError: (e) => {
      toast({
        title: "Failed to create approval policy",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const updatePolicy = useMutation({
    mutationFn: () =>
      requestJson("PATCH", `/api/approval-policies/${editingId}`, toPayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      toast({ title: "Approval policy updated" });
      resetForm();
    },
    onError: (e) => {
      toast({
        title: "Failed to update approval policy",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const deletePolicy = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `/api/approval-policies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      toast({ title: "Approval policy deleted" });
    },
    onError: (e) => {
      toast({
        title: "Failed to delete approval policy",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval Policies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-2 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              toast({ title: "Policy name is required", variant: "destructive" });
              return;
            }
            if (Number.isNaN(Number(amountMin)) || Number.isNaN(Number(approvalLevel))) {
              toast({ title: "Amount min and level must be valid numbers", variant: "destructive" });
              return;
            }
            if (amountMax.trim() && Number.isNaN(Number(amountMax))) {
              toast({ title: "Amount max must be a valid number", variant: "destructive" });
              return;
            }
            if (editingId != null) {
              updatePolicy.mutate();
            } else {
              createPolicy.mutate();
            }
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="policy-name">Policy name</Label>
            <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-entity">Entity</Label>
            <Select value={entityType} onValueChange={(value: "requisition" | "purchase_order") => setEntityType(value)}>
              <SelectTrigger id="policy-entity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="requisition">Requisition</SelectItem>
                <SelectItem value="purchase_order">Purchase Order</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-min">Amount min</Label>
            <Input id="policy-min" type="number" min={0} value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-max">Amount max</Label>
            <Input id="policy-max" type="number" min={0} value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-level">Approval level</Label>
            <Input id="policy-level" type="number" min={1} value={approvalLevel} onChange={(e) => setApprovalLevel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-role">Approver role</Label>
            <Input id="policy-role" value={approverRole} onChange={(e) => setApproverRole(e.target.value)} placeholder="manager/admin" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-user">Approver user ID</Label>
            <Input id="policy-user" type="number" min={1} value={approverUserId} onChange={(e) => setApproverUserId(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" variant={isActive ? "default" : "outline"} onClick={() => setIsActive((v) => !v)}>
              {isActive ? "Active" : "Inactive"}
            </Button>
            {editingId != null ? (
              <>
                <Button type="submit" disabled={updatePolicy.isPending}>
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={createPolicy.isPending}>
                Add
              </Button>
            )}
          </div>
        </form>

        <div className="rounded-md border">
          {isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">Loading...</div>
          ) : data.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No approval policies yet.</div>
          ) : (
            <div className="divide-y">
              {data.map((row) => (
                <div key={row.id} className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-sm font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.entityType} | {row.amountMin} - {row.amountMax ?? "No max"} | Level {row.approvalLevel}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Role: {row.approverRole ?? "-"} | User: {row.approverUserId ?? "-"} | {row.isActive ? "Active" : "Inactive"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(row.id);
                        setName(row.name);
                        setEntityType(row.entityType);
                        setAmountMin(String(row.amountMin ?? 0));
                        setAmountMax(row.amountMax == null ? "" : String(row.amountMax));
                        setApprovalLevel(String(row.approvalLevel ?? 1));
                        setApproverRole(row.approverRole ?? "");
                        setApproverUserId(row.approverUserId == null ? "" : String(row.approverUserId));
                        setIsActive(Boolean(row.isActive));
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => deletePolicy.mutate(row.id)}>
                      Delete
                    </Button>
                  </div>
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
          <TabsTrigger value="approvalPolicies">Approval Policies</TabsTrigger>
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
        <TabsContent value="approvalPolicies">
          <ApprovalPoliciesTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
