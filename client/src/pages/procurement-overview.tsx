import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ClipboardCheck, FileSearch, PackageCheck, ShoppingCart, Truck, WalletCards } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { PageDataState } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { useReportingMoney } from "@/hooks/use-reporting-money";

type Overview = {
  kpis: { openRequisitions: number; pendingApprovals: number; openRfqs: number; openPurchaseOrders: number; awaitingConfirmation: number; partiallyReceived: number; lateDeliveries: number; exceptions: number; spendThisPeriod: string; unmatchedInvoices: number };
  needsAttention: Array<{ id: number; number: string; status: string; amount: string; updatedAt: string }>;
  lateOrders: Array<{ id: number; number: string; status: string; expectedDeliveryDate: string; amount: string }>;
  poStatus: Array<{ label: string; value: number }>;
  spendBySupplier: Array<{ label: string; value: string }>;
  generatedAt: string;
};

export default function ProcurementOverviewPage() {
  const { formatMoney } = useReportingMoney();
  const overview = useQuery({ queryKey: ["/api/v2/procurement/overview"], queryFn: () => requestJson<Overview>("GET", "/api/v2/procurement/overview") });
  const data = overview.data;
  const cards = data ? [
    ["Open requisitions", data.kpis.openRequisitions, ClipboardCheck, APP_ROUTES.procurement.requisitions, "procurement-kpi-open-requisitions"],
    ["Pending approvals", data.kpis.pendingApprovals, ClipboardCheck, APP_ROUTES.procurement.requisitions, "procurement-kpi-pending-approvals"],
    ["Open RFQs", data.kpis.openRfqs, FileSearch, APP_ROUTES.procurement.sourcing, "procurement-kpi-open-rfqs"],
    ["Open purchase orders", data.kpis.openPurchaseOrders, ShoppingCart, APP_ROUTES.procurement.orders, "procurement-kpi-open-pos"],
    ["Awaiting confirmation", data.kpis.awaitingConfirmation, Truck, APP_ROUTES.procurement.orders, "procurement-kpi-awaiting-confirmation"],
    ["Partially received", data.kpis.partiallyReceived, PackageCheck, APP_ROUTES.procurement.receiving, "procurement-kpi-partially-received"],
    ["Late deliveries", data.kpis.lateDeliveries, AlertTriangle, APP_ROUTES.operations.logistics, "procurement-kpi-late-deliveries"],
    ["Exceptions", data.kpis.exceptions, AlertTriangle, APP_ROUTES.procurement.exceptions, "procurement-kpi-exceptions"],
  ] as const : [];
  const maxPo = Math.max(1, ...(data?.poStatus.map((row) => Number(row.value)) ?? [1]));
  const maxSpend = Math.max(1, ...(data?.spendBySupplier.map((row) => Number(row.value)) ?? [1]));

  return <div className="space-y-6" data-testid="procurement-overview-page">
    <PageHeader title="Procurement overview" subtitle="One command centre for demand, sourcing, commitments, supplier confirmation, receiving, matching, and risk." actions={<div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href={APP_ROUTES.procurement.settings}>Procurement settings</Link></Button><Button asChild><Link href={APP_ROUTES.procurement.requisitionNew}>Create requisition</Link></Button></div>} />
    <PageDataState isLoading={overview.isLoading} error={overview.error} isEmpty={!data} emptyView={<div className="py-12 text-center text-muted-foreground">Procurement data is unavailable.</div>} onRetry={() => void overview.refetch()}>
      {data ? <div className="space-y-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, count, Icon, href, testId]) => <Card key={label} data-testid={testId}><CardContent className="flex items-start justify-between gap-3 p-4"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p><Button asChild variant="link" className="h-auto p-0 text-xs"><Link href={href}>Review <ArrowRight className="ml-1 h-3 w-3" /></Link></Button></div><Icon className="h-5 w-5 text-primary" /></CardContent></Card>)}</section>
        <section className="grid gap-3 md:grid-cols-2"><Card><CardContent className="flex items-center justify-between gap-4 p-5"><div><p className="text-sm text-muted-foreground">Spend this period</p><p className="text-2xl font-semibold tabular-nums">{formatMoney(Number(data.kpis.spendThisPeriod))}</p></div><WalletCards className="h-6 w-6 text-primary" /></CardContent></Card><Card><CardContent className="flex items-center justify-between gap-4 p-5"><div><p className="text-sm text-muted-foreground">Unmatched invoices</p><p className="text-2xl font-semibold tabular-nums">{data.kpis.unmatchedInvoices}</p></div><Button asChild variant="outline"><Link href={APP_ROUTES.finance.accountsPayableExceptions}>Open AP exceptions</Link></Button></CardContent></Card></section>
        <section className="grid gap-4 xl:grid-cols-2"><Card data-testid="procurement-pipeline-chart"><CardHeader><CardTitle className="text-base">PO status distribution</CardTitle></CardHeader><CardContent className="space-y-3">{data.poStatus.map((row) => <div key={row.label}><div className="mb-1 flex justify-between text-sm"><span>{row.label}</span><span>{row.value}</span></div><div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(3, Number(row.value) / maxPo * 100)}%` }} /></div></div>)}</CardContent></Card><Card data-testid="procurement-spend-supplier-chart"><CardHeader><CardTitle className="text-base">Spend by supplier</CardTitle></CardHeader><CardContent className="space-y-3">{data.spendBySupplier.map((row) => <div key={row.label}><div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{row.label}</span><span>{formatMoney(Number(row.value))}</span></div><div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(3, Number(row.value) / maxSpend * 100)}%` }} /></div></div>)}</CardContent></Card></section>
        <Card data-testid="procurement-needs-attention-table"><CardHeader><CardTitle>Needs attention</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Status</TableHead><TableHead>Amount</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{data.needsAttention.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.number}</TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell><TableCell>{formatMoney(Number(row.amount))}</TableCell><TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={APP_ROUTES.procurement.requisition(row.id)}>Open</Link></Button></TableCell></TableRow>)}{data.needsAttention.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No requisition requires attention.</TableCell></TableRow> : null}</TableBody></Table></CardContent></Card>
        <p className="text-xs text-muted-foreground">Server snapshot generated {new Date(data.generatedAt).toLocaleString()}.</p>
      </div> : null}
    </PageDataState>
  </div>;
}
