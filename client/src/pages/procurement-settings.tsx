import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageDataState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type Settings = { phase1Enabled: boolean; phase2Enabled: boolean; phase3Enabled: boolean; phase4Enabled: boolean; confirmationDueDays: number; budgetControlMode: "WARNING_ONLY" | "WARN_APPROVAL" | "HARD_BLOCK"; receiptOverTolerancePct: string; priceVarianceTolerancePct: string; quantityVarianceTolerancePct: string };

export default function ProcurementSettingsPage() {
  const { toast } = useToast();
  const query = useQuery({ queryKey: ["/api/v2/procurement/settings"], queryFn: () => requestJson<Settings>("GET", "/api/v2/procurement/settings") });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => { if (query.data) setForm(query.data); }, [query.data]);
  const save = useMutation({ mutationFn: () => requestJson("PATCH", "/api/v2/procurement/settings", form), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["/api/v2/procurement/settings"] }); toast({ title: "Procurement controls saved" }); }, onError: (error: Error) => toast({ title: "Save failed", description: error.message, variant: "destructive" }) });
  const links = [["Master Data", APP_ROUTES.admin.masterData, "Suppliers, currencies, tax, UOM, warehouses, terms, and Incoterms"], ["Approval policies", APP_ROUTES.finance.approvalPolicies, "Amount bands, roles, approvers, and independent approval"], ["Workflow governance", APP_ROUTES.admin.workflows, "Controlled lifecycle and audit coverage"], ["Organization settings", APP_ROUTES.admin.settings, "Reporting currency, inventory, finance, and presentation authority"]] as const;
  return <div className="space-y-6"><PageHeader title="Procurement settings" subtitle="A composed control hub over the app’s authoritative settings, Master Data, approvals, and workflow services." />
    <PageDataState isLoading={query.isLoading} error={query.error} isEmpty={!form} emptyView={<div className="py-12 text-center text-muted-foreground">Procurement controls are unavailable.</div>} onRetry={() => void query.refetch()}>{form ? <div className="space-y-6">
      <Card><CardHeader><CardTitle>Release controls</CardTitle><CardDescription>Enable completed procurement phases per organization without replacing stable workflows.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{([1,2,3,4] as const).map((phase) => { const key = `phase${phase}Enabled` as const; return <div key={phase} className="flex items-center justify-between rounded-md border p-4"><div><Label htmlFor={key}>Phase {phase}</Label><p className="text-xs text-muted-foreground">{phase === 1 ? "Control centre and lifecycle" : phase === 2 ? "BPA and receiving" : phase === 3 ? "Pricing, budgets, analytics" : "Returns and debit notes"}</p></div><Switch id={key} checked={form[key]} onCheckedChange={(checked) => setForm({ ...form, [key]: checked })} /></div>; })}</CardContent></Card>
      <Card><CardHeader><CardTitle>Transaction policy</CardTitle><CardDescription>These values are enforced by the server; UI warnings never replace authorization.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="space-y-2"><Label htmlFor="confirmation-days">Supplier confirmation due (days)</Label><Input id="confirmation-days" type="number" min={1} max={90} value={form.confirmationDueDays} onChange={(event) => setForm({ ...form, confirmationDueDays: Number(event.target.value) })} /></div><div className="space-y-2"><Label>Budget control</Label><Select value={form.budgetControlMode} onValueChange={(budgetControlMode: Settings["budgetControlMode"]) => setForm({ ...form, budgetControlMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="WARNING_ONLY">Warning only</SelectItem><SelectItem value="WARN_APPROVAL">Warning + elevated approval</SelectItem><SelectItem value="HARD_BLOCK">Hard block</SelectItem></SelectContent></Select></div>{(["receiptOverTolerancePct","priceVarianceTolerancePct"] as const).map((key) => <div className="space-y-2" key={key}><Label htmlFor={key}>{key === "receiptOverTolerancePct" ? "Receipt over-tolerance %" : "Price variance tolerance %"}</Label><Input id={key} type="number" min={0} max={100} step="0.01" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></div>)}</CardContent></Card>
      <div className="grid gap-4 md:grid-cols-2">{links.map(([title, href, description]) => <Card key={title}><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href={href}>Open {title}</Link></Button></CardContent></Card>)}</div>
      <div className="flex justify-end"><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save procurement controls"}</Button></div>
    </div> : null}</PageDataState>
  </div>;
}
