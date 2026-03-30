import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Bug, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { actionErrorStore, type ActionErrorRecord } from "@/lib/action-error-store";
import { requestJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-1">
      <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

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
      await requestJson(latest.retryMethod, latest.retryEndpoint, latest.retryPayload);
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

  const statusLabel = latest?.status != null ? String(latest.status) : "n/a";
  const isClientError = latest?.status != null && latest.status >= 400 && latest.status < 500;

  return (
    <>
      {latest ? (
        <div className="fixed bottom-4 right-4 z-50">
          <Button variant="destructive" className="max-w-[min(100vw-2rem,20rem)] gap-2" onClick={() => setOpen(true)}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">Action failed — tap for details</span>
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
        <DialogContent className="max-w-2xl gap-0">
          <DialogHeader className="space-y-1 border-b border-border pb-4 text-left">
            <DialogTitle className="text-xl">Something went wrong</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {latest?.reason ?? "The request did not complete. Review the details below or retry from the page."}
            </DialogDescription>
          </DialogHeader>

          {latest ? (
            <div className="space-y-4 py-4">
              <Alert variant={isClientError ? "default" : "destructive"} className="border">
                <AlertTitle className="text-sm font-semibold">
                  {latest.method} {latest.endpoint}
                </AlertTitle>
                <AlertDescription className="mt-1 space-y-1 text-sm">
                  <span className="font-medium">HTTP {statusLabel}</span>
                  {latest.reason ? (
                    <span className="block text-foreground/90">{latest.reason}</span>
                  ) : null}
                </AlertDescription>
              </Alert>

              <dl className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                <DetailRow label="Module">{latest.module ?? "—"}</DetailRow>
                <DetailRow label="Action">{latest.action ?? "—"}</DetailRow>
                <DetailRow label="Request ID">
                  {latest.requestId ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{latest.requestId}</code>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label="Payload">{latest.payloadSummary ?? "—"}</DetailRow>
                <DetailRow label="Time">{new Date(latest.timestamp).toLocaleString()}</DetailRow>
              </dl>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Response body</p>
                <ScrollArea className="max-h-40 rounded-md border border-border bg-muted/50">
                  <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-foreground">
                    {prettyRaw}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          ) : null}

          <DialogFooter className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button variant="outline" onClick={copyDiagnostics} className="gap-2">
              <Copy className="h-4 w-4" />
              Copy full report
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
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
            {canSeeDiagnostics ? (
              <Button variant="secondary" className="gap-2" onClick={() => setDiagnosticsOpen(true)}>
                <Bug className="h-4 w-4" />
                Admin log
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
            <DialogTitle>Admin diagnostics</DialogTitle>
            <DialogDescription>Recent captured failure records (JSON).</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[420px] rounded-md border border-border bg-muted/30 p-2">
            <div className="space-y-3 pr-3">
              {history.map((entry) => (
                <div key={entry.id} className="rounded border border-border bg-card p-3 text-xs">
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
