import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, GitBranch, History, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { requestJson } from "@/lib/queryClient";
import type { ApprovalWorkflowCatalogItem, WorkflowBlueprint } from "@shared/authority-catalogs";

type GovernanceSummary = {
  blueprints: WorkflowBlueprint[];
  approvalCatalog: ApprovalWorkflowCatalogItem[];
  metrics: {
    activeRules: number;
    configuredWorkflows: number;
    governedWorkflows: number;
    pendingApprovals: number;
    overdueApprovals: number;
    highRiskRules: number;
    lastRuleChange: string | null;
  };
  rulesByEntity: Record<string, number>;
  pending: Array<{ entityType: string; entityId: number; status: string | null; level: number; submittedAt: string; overdue: boolean }>;
  recentActions: Array<{ id: number; entityType: string; entityId: number; action: string; level: number; comment: string | null; performedAt: string; actorName: string }>;
};

function isGovernanceSummary(value: unknown): value is GovernanceSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GovernanceSummary>;
  return Boolean(
    Array.isArray(candidate.blueprints) &&
    Array.isArray(candidate.approvalCatalog) &&
    candidate.metrics && typeof candidate.metrics.configuredWorkflows === "number" &&
    candidate.rulesByEntity &&
    Array.isArray(candidate.pending) &&
    Array.isArray(candidate.recentActions),
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function entityWorkspace(entityType: string, entityId?: number) {
  if (entityType === "requisition") return entityId ? APP_ROUTES.procurement.requisition(entityId) : APP_ROUTES.procurement.requisitions;
  if (entityType === "purchase_order") return entityId ? APP_ROUTES.procurement.order(entityId) : APP_ROUTES.procurement.orders;
  if (entityType === "invoice" || entityType === "payment_batch") return APP_ROUTES.finance.accountsPayable;
  if (entityType === "commercial_quotation") return entityId ? APP_ROUTES.procurement.commercialQuotation(entityId) : APP_ROUTES.procurement.commercialQuotations;
  if (entityType === "contract") return APP_ROUTES.procurement.contracts;
  if (entityType === "supplier_onboarding") return APP_ROUTES.procurement.suppliers;
  if (entityType === "inventory_adjustment" || entityType === "inventory_transfer") return APP_ROUTES.inventory.warehouseOperations;
  if (entityType === "master_data_change") return APP_ROUTES.admin.masterData;
  return APP_ROUTES.operations.controlTower;
}

export default function WorkflowGovernancePage() {
  const summary = useQuery({
    queryKey: ["/api/workflows/governance/summary"],
    queryFn: async () => {
      const payload = await requestJson<unknown>("GET", "/api/workflows/governance/summary");
      if (!isGovernanceSummary(payload)) {
        throw new Error("The workflow governance service returned an incompatible response. Restart the local server and retry.");
      }
      return payload;
    },
  });
  const [selectedId, setSelectedId] = useState("requisitions");
  const selected = useMemo(
    () => summary.data?.blueprints.find((workflow) => workflow.id === selectedId) ?? summary.data?.blueprints[0],
    [selectedId, summary.data?.blueprints],
  );

  const kpis = summary.data ? [
    ["Configured workflows", `${summary.data.metrics.configuredWorkflows}/${summary.data.metrics.governedWorkflows}`, "workflow-kpi-active", ShieldCheck],
    ["Active approval rules", summary.data.metrics.activeRules, "workflow-kpi-active-rules", GitBranch],
    ["Pending approvals", summary.data.metrics.pendingApprovals, "workflow-kpi-pending-approvals", Clock3],
    ["Overdue approvals", summary.data.metrics.overdueApprovals, "workflow-kpi-overdue-approvals", AlertCircle],
    ["High-control rules", summary.data.metrics.highRiskRules, "workflow-kpi-high-risk-rules", ShieldCheck],
    ["Recent decisions", summary.data.recentActions.length, "workflow-kpi-recent-actions", History],
  ] as const : [];

  return (
    <PageShell className="space-y-6 py-8" data-testid="workflow-governance-page">
      <PageHeader
        title="Workflow Governance"
        subtitle="Configure, monitor, and audit controlled business processes across the app."
        description="Domain services enforce valid state transitions; Approval Policies control who may approve, at which level, and for which amount band."
        icon={GitBranch}
        breadcrumb={<span>Admin / Workflow Governance</span>}
        actions={<div className="flex flex-wrap gap-2"><Button asChild><Link href={APP_ROUTES.finance.approvalPolicies}>Configure approval rules</Link></Button><Button asChild variant="outline"><Link href={APP_ROUTES.admin.employeeProfiles}>Approval limits</Link></Button><Button asChild variant="outline"><Link href={APP_ROUTES.admin.auditLogs}>Workflow audit</Link></Button></div>}
      />

      {summary.isLoading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading workflow governance data…</CardContent></Card> : null}
      {summary.isError ? <Alert variant="destructive"><AlertTitle>Workflow governance could not load</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3">{summary.error instanceof Error ? summary.error.message : "The governance service is unavailable."}<Button size="sm" variant="outline" onClick={() => void summary.refetch()}>Retry</Button></AlertDescription></Alert> : null}

      {summary.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {kpis.map(([label, value, testId, Icon]) => <Card key={label} data-testid={testId}><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div><Icon className="h-5 w-5 text-primary" /></CardContent></Card>)}
          </div>

          <Card>
            <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
              <div><CardTitle>Application workflow map</CardTitle><CardDescription>Select a domain to review its controlled stages, exception paths, and enforced guardrails.</CardDescription></div>
              <Select value={selected?.id ?? selectedId} onValueChange={setSelectedId}><SelectTrigger className="w-full md:w-72" aria-label="Workflow domain"><SelectValue /></SelectTrigger><SelectContent>{summary.data.blueprints.map((workflow) => <SelectItem key={workflow.id} value={workflow.id}>{workflow.label}</SelectItem>)}</SelectContent></Select>
            </CardHeader>
            {selected ? <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center gap-2" aria-label={`${selected.label} stages`}>
                {selected.stages.map((stage, index) => <div key={stage} className="flex items-center gap-2"><Badge variant={index === 0 ? "secondary" : "outline"} className="px-3 py-1.5">{stage}</Badge>{index < selected.stages.length - 1 ? <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null}</div>)}
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-lg border p-4 lg:col-span-2"><h3 className="font-medium">Controls</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{selected.controls.map((control) => <li key={control} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{control}</li>)}</ul></div>
                <div className="rounded-lg border p-4"><h3 className="font-medium">Alternative states</h3><div className="mt-3 flex flex-wrap gap-2">{selected.alternativeStates.map((state) => <Badge key={state} variant="secondary">{state}</Badge>)}</div></div>
              </div>
              <div className="flex flex-wrap gap-2"><Button asChild><Link href={selected.workspacePath}>Open {selected.label}</Link></Button>{selected.entityTypes[0] ? <Button asChild variant="outline"><Link href={`${APP_ROUTES.finance.approvalPolicies}?entity=${encodeURIComponent(selected.entityTypes[0])}`}>Configure this workflow</Link></Button> : null}</div>
            </CardContent> : null}
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card><CardHeader><CardTitle>Approval-rule coverage</CardTitle><CardDescription>Every governed entity remains visible even when no active rule is configured.</CardDescription></CardHeader><CardContent><div className="grid gap-2 sm:grid-cols-2">{summary.data.approvalCatalog.map((item) => { const count = Number(summary.data.rulesByEntity[item.entityType] ?? 0); return <Link key={item.entityType} href={`${APP_ROUTES.finance.approvalPolicies}?entity=${encodeURIComponent(item.entityType)}`} className="flex items-center justify-between rounded-md border p-3 hover:bg-accent/50"><div><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.amountBased ? "Amount-based routing" : "Governance approval"}</p></div><Badge variant={count > 0 ? "default" : "destructive"}>{count > 0 ? `${count} rule${count === 1 ? "" : "s"}` : "Setup required"}</Badge></Link>; })}</div></CardContent></Card>
            <Card><CardHeader><CardTitle>Pending work queue</CardTitle><CardDescription>Latest submitted records still waiting in an approval state. The standard SLA is 48 hours.</CardDescription></CardHeader><CardContent>{summary.data.pending.length === 0 ? <p className="text-sm text-muted-foreground">No approvals are currently waiting.</p> : <Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Level</TableHead><TableHead>Submitted</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{summary.data.pending.map((item) => <TableRow key={`${item.entityType}-${item.entityId}`}><TableCell><Link className="font-medium text-primary hover:underline" href={entityWorkspace(item.entityType, item.entityId)}>{humanize(item.entityType)} #{item.entityId}</Link></TableCell><TableCell>{item.level}</TableCell><TableCell>{new Date(item.submittedAt).toLocaleString()}</TableCell><TableCell><Badge variant={item.overdue ? "destructive" : "secondary"}>{item.overdue ? "Overdue" : "Waiting"}</Badge></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
          </div>

          <Card><CardHeader><CardTitle>Recent workflow decisions</CardTitle><CardDescription>Approval history is tenant-scoped and links back to the affected record.</CardDescription></CardHeader><CardContent>{summary.data.recentActions.length === 0 ? <p className="text-sm text-muted-foreground">No workflow decisions have been recorded yet.</p> : <Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Record</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Comment</TableHead></TableRow></TableHeader><TableBody>{summary.data.recentActions.slice(0, 10).map((event) => <TableRow key={event.id}><TableCell>{new Date(event.performedAt).toLocaleString()}</TableCell><TableCell><Link className="text-primary hover:underline" href={entityWorkspace(event.entityType, event.entityId)}>{humanize(event.entityType)} #{event.entityId}</Link></TableCell><TableCell><Badge variant="outline">{humanize(event.action)}</Badge></TableCell><TableCell>{event.actorName}</TableCell><TableCell className="max-w-xs truncate">{event.comment || "—"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
        </>
      ) : null}
    </PageShell>
  );
}
