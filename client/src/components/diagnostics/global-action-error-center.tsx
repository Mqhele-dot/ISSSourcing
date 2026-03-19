import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bug, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { actionErrorStore, type ActionErrorRecord } from "@/lib/action-error-store";
import { requestJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

export function GlobalActionErrorCenter() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [latest, setLatest] = useState<ActionErrorRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [history, setHistory] = useState<ActionErrorRecord[]>(() => actionErrorStore.list());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    return actionErrorStore.subscribe((record) => {
      setLatest(record);
      setHistory(actionErrorStore.list());
      setOpen(true);
    });
  }, []);

  const canSeeDiagnostics = user?.role === "admin";
  const prettyRaw = useMemo(
    () => (latest?.raw != null ? JSON.stringify(latest.raw, null, 2) : "No payload captured"),
    [latest?.raw],
  );

  useEffect(() => {
    if (!latest) return;
    toast({
      title: `${latest.action ?? "Action"} failed`,
      description: `${latest.method} ${latest.endpoint} • ${latest.status ?? "n/a"} • ${latest.reason}`,
      variant: "destructive",
    });
  }, [latest, toast]);
  const copyDiagnostics = async () => {
    if (!latest) return;
    const text = JSON.stringify(latest, null, 2);
    await navigator.clipboard.writeText(text);
    toast({ title: "Diagnostics copied", description: "Failure details copied to clipboard." });
  };
  const copyEndpoint = async (endpoint: string) => {
    await navigator.clipboard.writeText(endpoint);
    toast({ title: "Endpoint copied", description: endpoint });
  };

  const retryLatest = async () => {
    if (!latest?.retryMethod || !latest?.retryEndpoint || retrying) return;
    setRetrying(true);
    try {
      await requestJson(
        latest.retryMethod,
        latest.retryEndpoint,
        latest.retryPayload,
      );
      toast({
        title: "Retry successful",
        description: `${latest.retryMethod} ${latest.retryEndpoint}`,
      });
      actionErrorStore.clearById(latest.id);
      setHistory(actionErrorStore.list());
      setLatest(actionErrorStore.list()[0] ?? null);
      setOpen(false);
    } catch (error) {
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      {latest ? (
        <div className="fixed bottom-4 right-4 z-50">
          <Button variant="destructive" className="gap-2" onClick={() => setOpen(true)}>
            <AlertTriangle className="h-4 w-4" />
            Action Failed
            {latest.requestId ? <Badge variant="secondary">{latest.requestId}</Badge> : null}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && latest) {
            actionErrorStore.clearById(latest.id);
            const nextHistory = actionErrorStore.list();
            setHistory(nextHistory);
            setLatest(nextHistory[0] ?? null);
          }
          setOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Action Failure Details</DialogTitle>
            <DialogDescription>
              Review what failed, then retry from the original page action.
            </DialogDescription>
          </DialogHeader>
          {latest ? (
            <div className="grid gap-3 text-sm">
              <div><strong>Method:</strong> {latest.method}</div>
              <div><strong>Endpoint:</strong> {latest.endpoint}</div>
              <div><strong>Status:</strong> {latest.status ?? "n/a"}</div>
              <div><strong>Module:</strong> {latest.module ?? "n/a"}</div>
              <div><strong>Action:</strong> {latest.action ?? "n/a"}</div>
              <div><strong>Reason:</strong> {latest.reason}</div>
              <div><strong>Request ID:</strong> {latest.requestId ?? "n/a"}</div>
              <div><strong>Payload Summary:</strong> {latest.payloadSummary ?? "n/a"}</div>
              <div><strong>Timestamp:</strong> {new Date(latest.timestamp).toLocaleString()}</div>
              <ScrollArea className="h-40 rounded border p-2 text-xs">
                <pre>{prettyRaw}</pre>
              </ScrollArea>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={copyDiagnostics} className="gap-2">
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            {latest ? (
              <Button variant="outline" onClick={() => copyEndpoint(latest.endpoint)} className="gap-2">
                <Copy className="h-4 w-4" />
                Copy endpoint
              </Button>
            ) : null}
            {latest?.retryMethod && latest?.retryEndpoint ? (
              <Button variant="outline" onClick={retryLatest} className="gap-2" disabled={retrying}>
                <RotateCcw className="h-4 w-4" />
                {retrying ? "Retrying..." : "Retry"}
              </Button>
            ) : null}
            {canSeeDiagnostics ? (
              <Button variant="secondary" className="gap-2" onClick={() => setDiagnosticsOpen(true)}>
                <Bug className="h-4 w-4" />
                Admin Diagnostics
              </Button>
            ) : null}
            <Button
              onClick={() => {
                if (latest) {
                  actionErrorStore.clearById(latest.id);
                  const nextHistory = actionErrorStore.list();
                  setHistory(nextHistory);
                  setLatest(nextHistory[0] ?? null);
                }
                setOpen(false);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Admin Diagnostics Drawer</DialogTitle>
            <DialogDescription>
              Latest mutation failures captured globally.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[420px] rounded border p-2">
            <div className="space-y-3">
              {history.map((entry) => (
                <div key={entry.id} className="rounded border p-3 text-xs">
                  <div className="font-medium">
                    {entry.method} {entry.endpoint}
                  </div>
                  <div>Module: {entry.module ?? "n/a"} | Action: {entry.action ?? "n/a"}</div>
                  <div>Status: {entry.status ?? "n/a"} | Request ID: {entry.requestId ?? "n/a"}</div>
                  <div>{entry.reason}</div>
                  <div className="mt-2 font-medium">Raw error JSON</div>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                    {entry.raw != null ? JSON.stringify(entry.raw, null, 2) : "No raw error payload captured"}
                  </pre>
                  <div className="mt-2 font-medium">Last successful response</div>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                    {entry.lastGoodResponse != null
                      ? JSON.stringify(entry.lastGoodResponse, null, 2)
                      : "No prior successful response captured for this endpoint"}
                  </pre>
                  {entry.stack ? (
                    <>
                      <div className="mt-2 font-medium">Stack (dev)</div>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">{entry.stack}</pre>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
