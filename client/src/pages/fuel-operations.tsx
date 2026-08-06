import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CircleDollarSign,
  Droplets,
  Flame,
  Fuel,
  Gauge,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { requestJson } from "@/lib/queryClient";
import { tankFillPercent } from "@shared/fuel-operations";

type FuelStation = { id: number; code: string; name: string; address: string | null; managerName: string | null; status: string };
type FuelTank = { id: number; stationId: number; code: string; productType: string; storageType: string; capacityLitres: number; currentLevelLitres: number; reorderLevelLitres: number; status: string };
type FuelPump = { id: number; stationId: number; tankId: number; code: string; currentMeterLitres: number; status: string };
type FuelDelivery = { id: number; stationId: number; tankId: number; deliveryReference: string; quantityLitres: number; unitCost: number | null; deliveredAt: string };
type FuelReconciliation = { id: number; stationId: number; pumpId: number; measuredSalesLitres: number; reportedSalesLitres: number; salesAmount: number; varianceLitres: number; status: string; shiftEndedAt: string };
type FuelPrice = { id: number; stationId: number; productType: string; pricePerLitre: number; effectiveFrom: string; active: boolean };
type FuelInspection = { id: number; stationId: number; tankId: number | null; inspectionType: string; result: string; notes: string | null; nextDueAt: string | null; inspectedAt: string };
type FuelCylinder = { id: number; stationId: number; serialNumber: string; gasFamily: string; capacityKg: number; status: string; testDueAt: string | null };

type FuelWorkspace = {
  generatedAt: string;
  summary: {
    stations: number;
    tanks: number;
    pumps: number;
    totalCapacityLitres: number;
    totalStockLitres: number;
    stockUtilizationPercent: number;
    lowStockTanks: number;
    lpgCylinders: number;
    cylindersDueForTest: number;
    safetyAttention: number;
    reconciliationVarianceLitres: number;
  };
  stations: FuelStation[];
  tanks: FuelTank[];
  pumps: FuelPump[];
  cylinders: FuelCylinder[];
  deliveries: FuelDelivery[];
  reconciliations: FuelReconciliation[];
  prices: FuelPrice[];
  inspections: FuelInspection[];
};

type FuelAction = "station" | "tank" | "pump" | "reading" | "delivery" | "reconciliation" | "price" | "cylinder" | "inspection";
type FormState = Record<string, string>;

const ACTION_LABELS: Record<FuelAction, string> = {
  station: "Add station",
  tank: "Add storage tank",
  pump: "Add pump",
  reading: "Record tank reading",
  delivery: "Record delivery",
  reconciliation: "Reconcile shift",
  price: "Set selling price",
  cylinder: "Add LPG cylinder",
  inspection: "Record safety inspection",
};

const PRODUCT_OPTIONS = [
  ["unleaded_93", "Unleaded 93"],
  ["unleaded_95", "Unleaded 95"],
  ["diesel_50ppm", "Diesel 50ppm"],
  ["diesel_500ppm", "Diesel 500ppm"],
  ["lpg", "LPG"],
] as const;

function formatProduct(value: string) {
  return PRODUCT_OPTIONS.find(([key]) => key === value)?.[1] ?? value.replaceAll("_", " ");
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function stationName(workspace: FuelWorkspace, id: number) {
  return workspace.stations.find((station) => station.id === id)?.name ?? `Station #${id}`;
}

function tankName(workspace: FuelWorkspace, id: number) {
  return workspace.tanks.find((tank) => tank.id === id)?.code ?? `Tank #${id}`;
}

function Field({ label, name, form, setForm, type = "text", min, step, required = true }: {
  label: string; name: string; form: FormState; setForm: (next: FormState) => void; type?: string; min?: string; step?: string; required?: boolean;
}) {
  return <div className="space-y-1.5"><Label htmlFor={`fuel-${name}`}>{label}</Label><Input id={`fuel-${name}`} name={name} type={type} min={min} step={step} required={required} value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} /></div>;
}

function NativeSelect({ label, name, value, onChange, children, disabled = false }: { label: string; name: string; value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  return <div className="space-y-1.5"><Label htmlFor={`fuel-${name}`}>{label}</Label><select id={`fuel-${name}`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select></div>;
}

function FuelActionDialog({ action, setAction, workspace }: { action: FuelAction | null; setAction: (action: FuelAction | null) => void; workspace: FuelWorkspace }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const firstStation = workspace.stations[0]?.id ? String(workspace.stations[0].id) : "";
  const firstTank = workspace.tanks[0]?.id ? String(workspace.tanks[0].id) : "";
  const firstPump = workspace.pumps[0]?.id ? String(workspace.pumps[0].id) : "";
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [form, setForm] = useState<FormState>({ stationId: firstStation, tankId: firstTank, pumpId: firstPump, productType: "unleaded_95", storageType: "underground_tank", source: "manual", status: "full", inspectionType: "daily_forecourt", result: "pass", deliveredAt: localNow, effectiveFrom: localNow, inspectedAt: localNow, shiftStartedAt: localNow, shiftEndedAt: localNow });

  const selectedStationId = Number(form.stationId || 0);
  const stationTanks = workspace.tanks.filter((tank) => !selectedStationId || tank.stationId === selectedStationId);
  const stationPumps = workspace.pumps.filter((pump) => !selectedStationId || pump.stationId === selectedStationId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const n = (key: string) => Number(form[key] ?? 0);
      const commonStation = { stationId: n("stationId") };
      const requests: Record<FuelAction, { method: "POST"; url: string; body: Record<string, unknown> }> = {
        station: { method: "POST", url: "/api/fuel/stations", body: { code: form.code, name: form.name, address: form.address || null, managerName: form.managerName || null } },
        tank: { method: "POST", url: "/api/fuel/tanks", body: { ...commonStation, code: form.code, productType: form.productType, storageType: form.storageType, capacityLitres: n("capacityLitres"), currentLevelLitres: n("currentLevelLitres"), reorderLevelLitres: n("reorderLevelLitres") } },
        pump: { method: "POST", url: "/api/fuel/pumps", body: { ...commonStation, tankId: n("tankId"), code: form.code, currentMeterLitres: n("currentMeterLitres") } },
        reading: { method: "POST", url: "/api/fuel/readings", body: { ...commonStation, tankId: n("tankId"), levelLitres: n("levelLitres"), waterLevelMm: n("waterLevelMm"), temperatureC: form.temperatureC ? n("temperatureC") : null, source: form.source } },
        delivery: { method: "POST", url: "/api/fuel/deliveries", body: { ...commonStation, tankId: n("tankId"), deliveryReference: form.deliveryReference, quantityLitres: n("quantityLitres"), unitCost: form.unitCost ? n("unitCost") : null, deliveredAt: form.deliveredAt } },
        reconciliation: { method: "POST", url: "/api/fuel/reconciliations", body: { ...commonStation, pumpId: n("pumpId"), openingMeterLitres: n("openingMeterLitres"), closingMeterLitres: n("closingMeterLitres"), reportedSalesLitres: n("reportedSalesLitres"), salesAmount: n("salesAmount"), shiftStartedAt: form.shiftStartedAt, shiftEndedAt: form.shiftEndedAt } },
        price: { method: "POST", url: "/api/fuel/prices", body: { ...commonStation, productType: form.productType, pricePerLitre: n("pricePerLitre"), effectiveFrom: form.effectiveFrom } },
        cylinder: { method: "POST", url: "/api/fuel/cylinders", body: { ...commonStation, serialNumber: form.serialNumber, gasFamily: form.gasFamily || "LPG", capacityKg: n("capacityKg"), tareWeightKg: form.tareWeightKg ? n("tareWeightKg") : null, status: form.status, testDueAt: form.testDueAt || null } },
        inspection: { method: "POST", url: "/api/fuel/inspections", body: { ...commonStation, tankId: form.tankId ? n("tankId") : null, inspectionType: form.inspectionType, result: form.result, checklist: { emergencyStops: form.emergencyStops !== "false", extinguishers: form.extinguishers !== "false", leaks: form.leaks !== "false" }, notes: form.notes || null, nextDueAt: form.nextDueAt || null, inspectedAt: form.inspectedAt } },
      };
      const request = requests[action];
      return requestJson(request.method, request.url, request.body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/fuel/workspace"] });
      toast({ title: action ? `${ACTION_LABELS[action]} saved` : "Fuel operation saved" });
      setAction(null);
    },
    onError: (error: Error) => toast({ title: "Fuel operation failed", description: error.message, variant: "destructive" }),
  });

  const set = (name: string) => (value: string) => setForm({ ...form, [name]: value });
  const stationSelect = <NativeSelect label="Station" name="stationId" value={form.stationId ?? ""} onChange={(value) => setForm({ ...form, stationId: value, tankId: "", pumpId: "" })}><option value="">Select station</option>{workspace.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</NativeSelect>;
  const tankSelect = <NativeSelect label="Tank" name="tankId" value={form.tankId ?? ""} onChange={set("tankId")}><option value="">Select tank</option>{stationTanks.map((tank) => <option key={tank.id} value={tank.id}>{tank.code} · {formatProduct(tank.productType)}</option>)}</NativeSelect>;

  return <Dialog open={action != null} onOpenChange={(open) => !open && setAction(null)}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{action ? ACTION_LABELS[action] : "Fuel operation"}</DialogTitle><DialogDescription>Values are validated against the active organization, selected station, and registered storage capacity.</DialogDescription></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    {action === "station" ? <><Field label="Station code" name="code" form={form} setForm={setForm} /><Field label="Station name" name="name" form={form} setForm={setForm} /><Field label="Address" name="address" form={form} setForm={setForm} required={false} /><Field label="Manager" name="managerName" form={form} setForm={setForm} required={false} /></> : null}
    {action === "tank" ? <>{stationSelect}<Field label="Tank code" name="code" form={form} setForm={setForm} /><NativeSelect label="Product" name="productType" value={form.productType} onChange={set("productType")}>{PRODUCT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect><NativeSelect label="Storage type" name="storageType" value={form.storageType} onChange={set("storageType")}><option value="underground_tank">Underground tank</option><option value="above_ground_tank">Above-ground tank</option><option value="lpg_bulk_tank">LPG bulk tank</option></NativeSelect><Field label="Capacity (L)" name="capacityLitres" type="number" min="0.01" step="0.01" form={form} setForm={setForm} /><Field label="Current level (L)" name="currentLevelLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Reorder level (L)" name="reorderLevelLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /></> : null}
    {action === "pump" ? <>{stationSelect}{tankSelect}<Field label="Pump code" name="code" form={form} setForm={setForm} /><Field label="Current totalizer (L)" name="currentMeterLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /></> : null}
    {action === "reading" ? <>{stationSelect}{tankSelect}<Field label="Level (L)" name="levelLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Water level (mm)" name="waterLevelMm" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Temperature °C" name="temperatureC" type="number" step="0.1" form={form} setForm={setForm} required={false} /><NativeSelect label="Reading source" name="source" value={form.source} onChange={set("source")}><option value="manual">Manual dip</option><option value="gauge">Gauge</option><option value="sensor">Sensor</option></NativeSelect></> : null}
    {action === "delivery" ? <>{stationSelect}{tankSelect}<Field label="Delivery reference" name="deliveryReference" form={form} setForm={setForm} /><Field label="Quantity (L)" name="quantityLitres" type="number" min="0.01" step="0.01" form={form} setForm={setForm} /><Field label="Unit cost" name="unitCost" type="number" min="0" step="0.01" form={form} setForm={setForm} required={false} /><Field label="Delivered at" name="deliveredAt" type="datetime-local" form={form} setForm={setForm} /></> : null}
    {action === "reconciliation" ? <>{stationSelect}<NativeSelect label="Pump" name="pumpId" value={form.pumpId ?? ""} onChange={set("pumpId")}><option value="">Select pump</option>{stationPumps.map((pump) => <option key={pump.id} value={pump.id}>{pump.code}</option>)}</NativeSelect><Field label="Opening meter (L)" name="openingMeterLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Closing meter (L)" name="closingMeterLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Reported sales (L)" name="reportedSalesLitres" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Sales amount" name="salesAmount" type="number" min="0" step="0.01" form={form} setForm={setForm} /><Field label="Shift started" name="shiftStartedAt" type="datetime-local" form={form} setForm={setForm} /><Field label="Shift ended" name="shiftEndedAt" type="datetime-local" form={form} setForm={setForm} /></> : null}
    {action === "price" ? <>{stationSelect}<NativeSelect label="Product" name="productType" value={form.productType} onChange={set("productType")}>{PRODUCT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect><Field label="Selling price per litre" name="pricePerLitre" type="number" min="0.01" step="0.01" form={form} setForm={setForm} /><Field label="Effective from" name="effectiveFrom" type="datetime-local" form={form} setForm={setForm} /></> : null}
    {action === "cylinder" ? <>{stationSelect}<Field label="Serial number" name="serialNumber" form={form} setForm={setForm} /><Field label="Gas family" name="gasFamily" form={form} setForm={setForm} required={false} /><Field label="Capacity (kg)" name="capacityKg" type="number" min="0.01" step="0.01" form={form} setForm={setForm} /><Field label="Tare weight (kg)" name="tareWeightKg" type="number" min="0.01" step="0.01" form={form} setForm={setForm} required={false} /><NativeSelect label="Status" name="status" value={form.status} onChange={set("status")}><option value="full">Full</option><option value="empty">Empty</option><option value="in_customer">With customer</option><option value="quarantine">Quarantine</option><option value="inspection_due">Inspection due</option></NativeSelect><Field label="Test due" name="testDueAt" type="date" form={form} setForm={setForm} required={false} /></> : null}
    {action === "inspection" ? <>{stationSelect}<NativeSelect label="Tank (optional)" name="tankId" value={form.tankId ?? ""} onChange={set("tankId")}><option value="">Whole station</option>{stationTanks.map((tank) => <option key={tank.id} value={tank.id}>{tank.code}</option>)}</NativeSelect><NativeSelect label="Inspection" name="inspectionType" value={form.inspectionType} onChange={set("inspectionType")}><option value="daily_forecourt">Daily forecourt</option><option value="tank_integrity">Tank integrity</option><option value="lpg_safety">LPG safety</option><option value="fire_equipment">Fire equipment</option><option value="environmental">Environmental</option></NativeSelect><NativeSelect label="Result" name="result" value={form.result} onChange={set("result")}><option value="pass">Pass</option><option value="conditional">Conditional</option><option value="fail">Fail and block tank</option></NativeSelect><Field label="Inspected at" name="inspectedAt" type="datetime-local" form={form} setForm={setForm} /><Field label="Next due" name="nextDueAt" type="date" form={form} setForm={setForm} required={false} /><div className="space-y-1.5 sm:col-span-2"><Label htmlFor="fuel-notes">Notes</Label><Textarea id="fuel-notes" value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div></> : null}
    <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={mutation.isPending || (action !== "station" && workspace.stations.length === 0)}>{mutation.isPending ? "Saving…" : "Save"}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

function TableEmpty({ message }: { message: string }) {
  return <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{message}</TableCell></TableRow>;
}

export default function FuelOperationsPage() {
  const [action, setAction] = useState<FuelAction | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({
    queryKey: ["/api/fuel/workspace"],
    queryFn: () => requestJson<FuelWorkspace>("GET", "/api/fuel/workspace"),
  });
  const workspace = workspaceQuery.data;
  const lowTanks = useMemo(() => workspace?.tanks.filter((tank) => tank.currentLevelLitres <= tank.reorderLevelLitres) ?? [], [workspace]);

  const cylinderStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => requestJson("PATCH", `/api/fuel/cylinders/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fuel/workspace"] }),
    onError: (error: Error) => toast({ title: "Cylinder update failed", description: error.message, variant: "destructive" }),
  });

  if (workspaceQuery.isLoading) return <PageShell><PageHeader title="Fuel Operations" subtitle="Loading stations, storage, pumps, LPG assets, and safety controls…" /><Card><CardContent className="p-8 text-sm text-muted-foreground">Loading Fuel Operations…</CardContent></Card></PageShell>;
  if (workspaceQuery.isError || !workspace) return <PageShell><PageHeader title="Fuel Operations" subtitle="LP gas and fuel-station operations" /><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Fuel Operations unavailable</AlertTitle><AlertDescription className="space-y-3"><p>{workspaceQuery.error instanceof Error ? workspaceQuery.error.message : "The workspace could not be loaded."}</p><Button type="button" variant="outline" size="sm" onClick={() => workspaceQuery.refetch()}>Retry</Button></AlertDescription></Alert></PageShell>;

  const summary = workspace.summary;
  const summaryCards: Array<{ title: string; value: string; description: string; Icon: typeof Droplets }> = [
    { title: "Station stock", value: `${formatNumber(summary.totalStockLitres)} L`, description: `${formatNumber(summary.stockUtilizationPercent)}% of ${formatNumber(summary.totalCapacityLitres)} L`, Icon: Droplets },
    { title: "Stations / tanks", value: `${summary.stations} / ${summary.tanks}`, description: `${summary.pumps} pumps`, Icon: Fuel },
    { title: "Low-stock tanks", value: String(summary.lowStockTanks), description: "At or below reorder level", Icon: Gauge },
    { title: "LPG cylinders", value: String(summary.lpgCylinders), description: `${summary.cylindersDueForTest} due for test`, Icon: Flame },
    { title: "Safety / variance", value: String(summary.safetyAttention), description: `${formatNumber(summary.reconciliationVarianceLitres)} L variance`, Icon: ShieldCheck },
  ];
  return <PageShell>
    <PageHeader title="Fuel Operations" subtitle="Manage fuel stations, LPG, tank stock, deliveries, pump sales, pricing, reconciliation, and safety in one workspace." breadcrumb={<span>Operations</span>} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => workspaceQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button onClick={() => setAction("station")}><Plus className="mr-2 h-4 w-4" />Add station</Button></div>} />

    {workspace.stations.length === 0 ? <Alert><Building2 className="h-4 w-4" /><AlertTitle>Set up the first station</AlertTitle><AlertDescription>Add a station before registering tanks, pumps, deliveries, cylinders, prices, or inspections.</AlertDescription></Alert> : null}
    {lowTanks.length > 0 ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>{lowTanks.length} tank{lowTanks.length === 1 ? "" : "s"} at or below reorder level</AlertTitle><AlertDescription>{lowTanks.map((tank) => `${tank.code} (${formatNumber(tank.currentLevelLitres)} L)`).join(", ")}</AlertDescription></Alert> : null}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {summaryCards.map(({ title, value, description, Icon }) => <Card key={title}><CardHeader className="pb-2"><CardDescription className="flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{description}</CardContent></Card>)}
    </div>

    <Tabs defaultValue="inventory" className="space-y-4">
      <TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="inventory">Stations & stock</TabsTrigger><TabsTrigger value="deliveries">Deliveries</TabsTrigger><TabsTrigger value="sales">Pumps, sales & pricing</TabsTrigger><TabsTrigger value="cylinders">LPG cylinders</TabsTrigger><TabsTrigger value="safety">Safety</TabsTrigger></TabsList>

      <TabsContent value="inventory" className="space-y-4"><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setAction("tank")} disabled={!workspace.stations.length}><Plus className="mr-2 h-4 w-4" />Add tank</Button><Button variant="outline" onClick={() => setAction("reading")} disabled={!workspace.tanks.length}><Gauge className="mr-2 h-4 w-4" />Record level</Button></div><Card><CardHeader><CardTitle>Storage inventory</CardTitle><CardDescription>Canonical station stock from the latest dip, gauge, sensor, delivery, and reconciled sales records.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Station</TableHead><TableHead>Tank</TableHead><TableHead>Product</TableHead><TableHead>Level</TableHead><TableHead>Capacity</TableHead><TableHead>Fill</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{workspace.tanks.length === 0 ? <TableEmpty message="No storage tanks configured." /> : workspace.tanks.map((tank) => { const fill = tankFillPercent(tank.currentLevelLitres, tank.capacityLitres); const low = tank.currentLevelLitres <= tank.reorderLevelLitres; return <TableRow key={tank.id}><TableCell>{stationName(workspace, tank.stationId)}</TableCell><TableCell className="font-medium">{tank.code}</TableCell><TableCell>{formatProduct(tank.productType)}</TableCell><TableCell>{formatNumber(tank.currentLevelLitres)} L</TableCell><TableCell>{formatNumber(tank.capacityLitres)} L</TableCell><TableCell className="min-w-36"><div className="flex items-center gap-2"><Progress value={fill} className="w-20" /><span className="text-xs">{formatNumber(fill)}%</span></div></TableCell><TableCell><Badge variant={tank.status === "blocked" || low ? "destructive" : "secondary"}>{tank.status === "blocked" ? "Blocked" : low ? "Reorder" : "Active"}</Badge></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="deliveries" className="space-y-4"><div className="flex justify-end"><Button onClick={() => setAction("delivery")} disabled={!workspace.tanks.length}><PackageCheck className="mr-2 h-4 w-4" />Record delivery</Button></div><Card><CardHeader><CardTitle>Fuel receipts</CardTitle><CardDescription>Received quantities update the selected tank only after capacity validation.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Station</TableHead><TableHead>Tank</TableHead><TableHead>Quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>Delivered</TableHead></TableRow></TableHeader><TableBody>{workspace.deliveries.length === 0 ? <TableEmpty message="No fuel deliveries recorded." /> : workspace.deliveries.map((delivery) => <TableRow key={delivery.id}><TableCell className="font-medium">{delivery.deliveryReference}</TableCell><TableCell>{stationName(workspace, delivery.stationId)}</TableCell><TableCell>{tankName(workspace, delivery.tankId)}</TableCell><TableCell>{formatNumber(delivery.quantityLitres)} L</TableCell><TableCell>{delivery.unitCost == null ? "—" : delivery.unitCost.toFixed(2)}</TableCell><TableCell>{formatDate(delivery.deliveredAt)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="sales" className="space-y-4"><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setAction("pump")} disabled={!workspace.tanks.length}><Plus className="mr-2 h-4 w-4" />Add pump</Button><Button variant="outline" onClick={() => setAction("price")} disabled={!workspace.stations.length}><CircleDollarSign className="mr-2 h-4 w-4" />Set price</Button><Button onClick={() => setAction("reconciliation")} disabled={!workspace.pumps.length}><Gauge className="mr-2 h-4 w-4" />Reconcile shift</Button></div><div className="grid gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle>Pumps and totalizers</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Pump</TableHead><TableHead>Station</TableHead><TableHead>Tank</TableHead><TableHead>Totalizer</TableHead></TableRow></TableHeader><TableBody>{workspace.pumps.length === 0 ? <TableEmpty message="No pumps configured." /> : workspace.pumps.map((pump) => <TableRow key={pump.id}><TableCell className="font-medium">{pump.code}</TableCell><TableCell>{stationName(workspace, pump.stationId)}</TableCell><TableCell>{tankName(workspace, pump.tankId)}</TableCell><TableCell>{formatNumber(pump.currentMeterLitres)} L</TableCell></TableRow>)}</TableBody></Table></CardContent></Card><Card><CardHeader><CardTitle>Current prices</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Station</TableHead><TableHead>Product</TableHead><TableHead>Per litre</TableHead><TableHead>Effective</TableHead></TableRow></TableHeader><TableBody>{workspace.prices.length === 0 ? <TableEmpty message="No selling prices configured." /> : workspace.prices.map((price) => <TableRow key={price.id}><TableCell>{stationName(workspace, price.stationId)}</TableCell><TableCell>{formatProduct(price.productType)}</TableCell><TableCell className="font-medium">{price.pricePerLitre.toFixed(2)}</TableCell><TableCell>{formatDate(price.effectiveFrom)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></div><Card><CardHeader><CardTitle>Shift reconciliation</CardTitle><CardDescription>Measured pump movement is compared with reported sales; variances above 0.5 L are flagged.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Shift end</TableHead><TableHead>Station</TableHead><TableHead>Pump</TableHead><TableHead>Measured</TableHead><TableHead>Reported</TableHead><TableHead>Variance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{workspace.reconciliations.length === 0 ? <TableEmpty message="No shifts reconciled." /> : workspace.reconciliations.map((row) => <TableRow key={row.id}><TableCell>{formatDate(row.shiftEndedAt)}</TableCell><TableCell>{stationName(workspace, row.stationId)}</TableCell><TableCell>{workspace.pumps.find((pump) => pump.id === row.pumpId)?.code ?? `#${row.pumpId}`}</TableCell><TableCell>{formatNumber(row.measuredSalesLitres)} L</TableCell><TableCell>{formatNumber(row.reportedSalesLitres)} L</TableCell><TableCell>{formatNumber(row.varianceLitres)} L</TableCell><TableCell><Badge variant={row.status === "balanced" ? "secondary" : "destructive"}>{row.status}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="cylinders" className="space-y-4"><div className="flex justify-end"><Button onClick={() => setAction("cylinder")} disabled={!workspace.stations.length}><Plus className="mr-2 h-4 w-4" />Add cylinder</Button></div><Card><CardHeader><CardTitle>LPG cylinder register</CardTitle><CardDescription>Track individual cylinders, custody state, capacity, and statutory test dates.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Serial</TableHead><TableHead>Station</TableHead><TableHead>Gas</TableHead><TableHead>Capacity</TableHead><TableHead>Test due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{workspace.cylinders.length === 0 ? <TableEmpty message="No LPG cylinders registered." /> : workspace.cylinders.map((cylinder) => <TableRow key={cylinder.id}><TableCell className="font-medium">{cylinder.serialNumber}</TableCell><TableCell>{stationName(workspace, cylinder.stationId)}</TableCell><TableCell>{cylinder.gasFamily}</TableCell><TableCell>{formatNumber(cylinder.capacityKg)} kg</TableCell><TableCell>{formatDate(cylinder.testDueAt)}</TableCell><TableCell><select aria-label={`Status for ${cylinder.serialNumber}`} className="rounded-md border bg-background px-2 py-1 text-sm" value={cylinder.status} disabled={cylinderStatus.isPending} onChange={(event) => cylinderStatus.mutate({ id: cylinder.id, status: event.target.value })}><option value="full">Full</option><option value="empty">Empty</option><option value="in_customer">With customer</option><option value="quarantine">Quarantine</option><option value="inspection_due">Inspection due</option></select></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

      <TabsContent value="safety" className="space-y-4"><div className="flex justify-end"><Button onClick={() => setAction("inspection")} disabled={!workspace.stations.length}><ShieldCheck className="mr-2 h-4 w-4" />Record inspection</Button></div><Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Fail-safe inspection logic</AlertTitle><AlertDescription>A failed tank inspection immediately marks that tank as blocked. Reopening requires a new passing inspection and a controlled status review.</AlertDescription></Alert><Card><CardHeader><CardTitle>Safety and compliance inspections</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Inspected</TableHead><TableHead>Station</TableHead><TableHead>Scope</TableHead><TableHead>Inspection</TableHead><TableHead>Result</TableHead><TableHead>Next due</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{workspace.inspections.length === 0 ? <TableEmpty message="No safety inspections recorded." /> : workspace.inspections.map((inspection) => <TableRow key={inspection.id}><TableCell>{formatDate(inspection.inspectedAt)}</TableCell><TableCell>{stationName(workspace, inspection.stationId)}</TableCell><TableCell>{inspection.tankId ? tankName(workspace, inspection.tankId) : "Whole station"}</TableCell><TableCell>{inspection.inspectionType.replaceAll("_", " ")}</TableCell><TableCell><Badge variant={inspection.result === "pass" ? "secondary" : "destructive"}>{inspection.result}</Badge></TableCell><TableCell>{formatDate(inspection.nextDueAt)}</TableCell><TableCell className="max-w-64 truncate">{inspection.notes || "—"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
    </Tabs>
    <FuelActionDialog key={action ?? "closed"} action={action} setAction={setAction} workspace={workspace} />
  </PageShell>;
}
