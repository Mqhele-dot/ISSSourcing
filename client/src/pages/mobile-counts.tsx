import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList, RefreshCw, ScanLine, Wifi, WifiOff } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { buildRequestHeaders, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import { enqueueOfflineAction, peekOfflineQueue } from "@/lib/offline-queue";

type CountSession = {
  id: number;
  warehouseId: number;
  mode: "blind" | "guided" | "spot" | "recount";
  status: string;
  assignedUserId: number | null;
  startedAt: string | null;
  submittedAt: string | null;
  postedAt: string | null;
};

type CountTarget = {
  id: number;
  itemId: number;
  locationId: string | null;
  systemQtySnapshot: number;
  blindMode: boolean;
};

type CountLine = {
  id: number;
  sessionId: number;
  targetId: number | null;
  itemId: number;
  countedQty: number;
  scanValue: string | null;
  createdAt: string;
};

type CountVariance = {
  id: number;
  itemId: number;
  deltaQty: number;
  requiresApproval: boolean;
  disposition: string;
};

type InventoryItem = { id: number; sku: string; name: string; quantity?: number; defaultWarehouseId?: number | null };

function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function mutationWithKey<T>(url: string, body: unknown, key: string): Promise<T> {
  const headers = await buildRequestHeaders("POST", undefined, { contentType: "application/json" });
  headers.set("Idempotency-Key", key);
  const res = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { message?: string } } | null;
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message ?? `Request failed (${res.status})`);
  }
  return payload?.data as T;
}

function useSessionIdFromLocation() {
  const [loc] = useLocation();
  const match = loc.match(/^\/m\/counts\/(\d+)/);
  return match ? Number(match[1]) : null;
}

export default function MobileCountsPage() {
  const { toast } = useToast();
  const [loc] = useLocation();
  const [, navigate] = useLocation();
  const sessionId = useSessionIdFromLocation();
  const isReview = Boolean(loc.match(/^\/m\/counts\/\d+\/review$/));
  const [selectedItemId, setSelectedItemId] = useState("none");
  const [countedQty, setCountedQty] = useState("0");
  const [scanValue, setScanValue] = useState("");
  const [warehouseId, setWarehouseId] = useState("1");
  const [mode, setMode] = useState<"blind" | "guided" | "spot" | "recount">("guided");

  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  const assigned = useQuery({
    queryKey: ["/api/mobile/counts/assigned"],
    queryFn: () => requestJson<{ sessions: CountSession[] }>("GET", "/api/mobile/counts/assigned"),
    enabled: !sessionId,
    throwOnError: false,
  });

  const inventory = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => normalizeApiList<InventoryItem>(await requestJson<unknown>("GET", "/api/inventory")),
    throwOnError: false,
  });

  const queue = useQuery({
    queryKey: ["offline-queue-peek", loc],
    queryFn: () => peekOfflineQueue(),
    refetchInterval: 5000,
  });

  const detail = useQuery({
    queryKey: ["/api/mobile/counts", sessionId],
    queryFn: () =>
      requestJson<{
        session: CountSession;
        targets: CountTarget[];
        lines: CountLine[];
        variances: CountVariance[];
      }>("GET", `/api/mobile/counts/${sessionId}`),
    enabled: Boolean(sessionId),
    throwOnError: false,
  });

  const selectedItem = useMemo(
    () => inventory.data?.find((item) => String(item.id) === selectedItemId),
    [inventory.data, selectedItemId],
  );

  const createSession = useMutation({
    mutationFn: async (asSpot: boolean) => {
      const firstItem = inventory.data?.[0];
      return mutationWithKey<{ session: CountSession; targets: CountTarget[] }>(
        "/api/mobile/counts",
        {
          warehouseId: Number(warehouseId),
          mode: asSpot ? "spot" : mode,
          deviceId: "browser-mobile",
          targets: firstItem
            ? [
                {
                  itemId: firstItem.id,
                  systemQtySnapshot: Number(firstItem.quantity ?? 0),
                  blindMode: mode === "blind",
                },
              ]
            : [],
        },
        idempotencyKey("count-session"),
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/counts/assigned"] });
      navigate(APP_ROUTES.operations.mobileCount(data.session.id));
    },
    onError: (error) => {
      toast({
        title: "Could not create count",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  const addLine = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("Open a count session first.");
      if (selectedItemId === "none") throw new Error("Select an item to count.");
      const body = {
        itemId: Number(selectedItemId),
        countedQty: Number(countedQty),
        scanValue: scanValue.trim() || selectedItem?.sku || null,
        deviceClockAt: new Date().toISOString(),
        syncStatus: online ? "synced" : "queued",
      };
      const key = idempotencyKey("count-line");
      if (!online) {
        await enqueueOfflineAction("mobile_count_line", { sessionId, ...body, deviceId: "browser-mobile", retryCount: 0 });
        return { offline: true };
      }
      return mutationWithKey(`/api/mobile/counts/${sessionId}/lines`, body, key);
    },
    onSuccess: () => {
      setCountedQty("0");
      setScanValue("");
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/counts", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["offline-queue-peek", loc] });
      toast({ title: online ? "Count line saved" : "Count line queued offline" });
    },
    onError: async (error) => {
      if (sessionId && selectedItemId !== "none") {
        await enqueueOfflineAction("mobile_count_line", {
          sessionId,
          itemId: Number(selectedItemId),
          countedQty: Number(countedQty),
          scanValue,
          deviceId: "browser-mobile",
        });
      }
      toast({
        title: "Count line queued",
        description: error instanceof Error ? error.message : "The action will sync when online sync is available.",
      });
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      mutationWithKey(`/api/mobile/counts/${sessionId}/submit`, { deviceId: "browser-mobile" }, idempotencyKey("count-submit")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/counts", sessionId] });
      toast({ title: "Count submitted", description: "Variance review is ready." });
    },
  });

  const approve = useMutation({
    mutationFn: () =>
      mutationWithKey(`/api/mobile/counts/${sessionId}/approve`, { deviceId: "browser-mobile" }, idempotencyKey("count-approve")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/counts", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Count approved and posted" });
    },
  });

  if (!sessionId) {
    const sessions = assigned.data?.sessions ?? [];
    return (
      <div className="space-y-4 p-4" data-testid="mobile-counts-page">
        <PageHeader title="Stock counts" description="Scan-first warehouse counting" />
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <Badge variant={online ? "default" : "destructive"} className="gap-1">
                {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {online ? "Online" : "Offline"}
              </Badge>
              <Badge variant="outline">{queue.data?.length ?? 0} pending sync</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Warehouse</Label>
                <Input value={warehouseId} inputMode="numeric" onChange={(event) => setWarehouseId(event.target.value)} />
              </div>
              <div>
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blind">Blind</SelectItem>
                    <SelectItem value="guided">Guided</SelectItem>
                    <SelectItem value="spot">Spot</SelectItem>
                    <SelectItem value="recount">Recount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => createSession.mutate(false)} disabled={createSession.isPending}>
                <ClipboardList className="mr-2 h-4 w-4" />
                New count
              </Button>
              <Button variant="outline" onClick={() => createSession.mutate(true)} disabled={createSession.isPending}>
                <ScanLine className="mr-2 h-4 w-4" />
                Spot count
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {sessions.map((session) => (
            <Link key={session.id} href={APP_ROUTES.operations.mobileCount(session.id)}>
              <Card className="active:bg-accent/50">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">Count #{session.id}</p>
                    <p className="text-sm text-muted-foreground">
                      Warehouse {session.warehouseId} · {session.mode} · {session.status}
                    </p>
                  </div>
                  <Badge variant="outline">{session.status}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
          {sessions.length === 0 && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">No assigned counts yet. Start a spot count or create a guided session.</CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  const session = detail.data?.session;
  const targets = detail.data?.targets ?? [];
  const lines = detail.data?.lines ?? [];
  const variances = detail.data?.variances ?? [];

  return (
    <div className="space-y-4 p-4" data-testid="mobile-count-session-page">
      <PageHeader
        title={isReview ? "Variance review" : `Count #${sessionId}`}
        description={session ? `Warehouse ${session.warehouseId} · ${session.mode} · ${session.status}` : "Loading count session"}
        breadcrumb={<Link href={APP_ROUTES.operations.mobileCounts}>Back</Link>}
      />

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <Badge variant={online ? "default" : "destructive"} className="gap-1">
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? "Online" : "Offline"}
          </Badge>
          <Badge variant="outline">{queue.data?.length ?? 0} pending sync</Badge>
        </CardContent>
      </Card>

      {isReview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Variance queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {variances.map((variance) => (
              <div key={variance.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="font-medium">Item #{variance.itemId}</p>
                  <p className="text-sm text-muted-foreground">Delta {variance.deltaQty}</p>
                </div>
                <Badge variant={variance.requiresApproval ? "destructive" : "outline"}>{variance.disposition}</Badge>
              </div>
            ))}
            {variances.length === 0 && <p className="text-sm text-muted-foreground">Submit the count to calculate variances.</p>}
            <Button className="w-full" onClick={() => approve.mutate()} disabled={approve.isPending || !variances.length}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve and post
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scan / enter count</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {session?.mode === "blind" && (
                <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  System quantities are hidden until review.
                </div>
              )}
              <div>
                <Label>Item</Label>
                <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select item</SelectItem>
                    {(inventory.data ?? []).map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.sku} · {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Scan value</Label>
                <Input
                  autoFocus
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  placeholder="Scan barcode or type SKU"
                />
              </div>
              <div>
                <Label>Counted quantity</Label>
                <Input inputMode="numeric" type="number" value={countedQty} onChange={(event) => setCountedQty(event.target.value)} />
              </div>
              <Button className="w-full" onClick={() => addLine.mutate()} disabled={addLine.isPending}>
                <ScanLine className="mr-2 h-4 w-4" />
                Save count line
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{lines.length} line(s) captured · {targets.length} target(s)</p>
              <div className="max-h-52 space-y-2 overflow-y-auto">
                {lines.map((line) => (
                  <div key={line.id} className="rounded-md border p-3 text-sm">
                    Item #{line.itemId}: {line.countedQty} {line.scanValue ? `· ${line.scanValue}` : ""}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => submit.mutate()} disabled={submit.isPending || lines.length === 0}>
                  Submit
                </Button>
                <Button asChild>
                  <Link href={APP_ROUTES.operations.mobileCountReview(sessionId)}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Review
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
