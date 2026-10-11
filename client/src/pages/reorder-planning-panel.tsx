import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { userFacingError } from "@/lib/user-facing-error";

type PlanningRow = { id: number; sku: string; name: string; onHand: string; availableNow: string;
  approvedInbound: string; observedDemand: string; suggestedQuantity: string; targetQuantity: string;
  lastEligibleIssue: string | null; estimatedValue: string | null; historyState: string };
type PlanningPage = { items: PlanningRow[]; total: number; page: number; pageSize: number; hasNext: boolean;
  lookbackDays: number; calculatedAt: string; notice: string };

function PlanningList({ kind }: { kind: "reorder-suggestions" | "slow-moving" }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [createdNumber, setCreatedNumber] = useState("");
  const createRequest = useMutation({
    mutationFn: (itemId: number) => requestJson<{ requestNumber: string }>("POST", `/api/v2/inventory/reorder-suggestions/${itemId}/request`, { lookbackDays }),
    onSuccess: (result) => { setCreatedNumber(result.requestNumber); void client.invalidateQueries({ queryKey: ["/api/v2/inventory", "reorder-suggestions"] }); void client.invalidateQueries({ queryKey: ["/api/reorder-requests"] }); },
  });
  const query = useQuery({
    queryKey: ["/api/v2/inventory", kind, page, lookbackDays],
    queryFn: () => requestJson<PlanningPage>("GET", `/api/v2/inventory/${kind}?page=${page}&pageSize=25&lookbackDays=${lookbackDays}`),
  });
  return <Card>
    <CardHeader>
      <CardTitle>{kind === "slow-moving" ? "Slow-moving stock" : "Demand-based suggestions"}</CardTitle>
      <CardDescription>{kind === "slow-moving" ? "Stock with no eligible issue during the selected period." : "Planning suggestions use warehouse totals, reservations, and approved inbound supply. They do not confirm quality-eligible stock for picking or allocation."}</CardDescription>
      <label className="text-sm">Lookback period <select className="ml-2 rounded border p-1" value={lookbackDays} onChange={(event) => { setLookbackDays(Number(event.target.value)); setPage(1); }}><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>365 days</option></select></label>
    </CardHeader>
    <CardContent className="space-y-3">
      {createdNumber && <p role="status" className="text-sm">Created pending reorder request {createdNumber}. Review it below before any approval or purchase conversion.</p>}
      {createRequest.isError && <p role="alert" className="text-sm text-destructive">{userFacingError(createRequest.error)}</p>}
      {query.isPending ? <p role="status">Calculating from stock movements…</p> : query.isError ? <div role="alert">Could not load planning data. <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></div> : <>
        <p className="text-sm text-muted-foreground">{query.data.total} item(s). {query.data.notice}</p>
        {query.data.items.length === 0 ? <p>No items match this period.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Item</th><th className="p-2">Available</th><th className="p-2">Demand</th><th className="p-2">{kind === "slow-moving" ? "Last issue" : "Suggested"}</th><th className="p-2">Value</th>{kind === "reorder-suggestions" && <th className="p-2">Action</th>}</tr></thead><tbody>{query.data.items.map((row) => <tr key={row.id} className="border-b"><td className="p-2"><Link className="underline" href={APP_ROUTES.inventory.item(row.sku)}>{row.name} ({row.sku})</Link></td><td className="p-2">{row.availableNow}</td><td className="p-2">{row.observedDemand} / {lookbackDays} days</td><td className="p-2">{kind === "slow-moving" ? row.lastEligibleIssue ? new Date(row.lastEligibleIssue).toLocaleDateString() : "No recorded issue" : row.historyState === "insufficient_history" ? "Insufficient history" : `${row.suggestedQuantity} (target ${row.targetQuantity}; inbound ${row.approvedInbound})`}</td><td className="p-2">{row.estimatedValue ?? "Cost unavailable"}</td>{kind === "reorder-suggestions" && <td className="p-2"><Button size="sm" variant="outline" disabled={createRequest.isPending} onClick={() => createRequest.mutate(row.id)}>Create request</Button></td>}</tr>)}</tbody></table></div>}
        <div className="flex items-center gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={!query.data.hasNext} onClick={() => setPage(page + 1)}>Next</Button></div>
      </>}
    </CardContent>
  </Card>;
}

export function ReorderPlanningPanel() {
  return <Tabs defaultValue="suggestions" className="mb-6"><TabsList><TabsTrigger value="suggestions">Suggestions</TabsTrigger><TabsTrigger value="slow">Slow-moving stock</TabsTrigger></TabsList><TabsContent value="suggestions"><PlanningList kind="reorder-suggestions" /></TabsContent><TabsContent value="slow"><PlanningList kind="slow-moving" /></TabsContent></Tabs>;
}
