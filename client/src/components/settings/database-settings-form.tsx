import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, HardDrive, Loader2, RefreshCcw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ElectronBridge, isElectronEnvironment } from "@/lib/electron-bridge";

type DesktopDatabaseInfo = {
  status: "healthy" | "degraded" | "error";
  size: string;
  location: string;
  lastBackup: string | null;
  dataCount: {
    inventory: number;
    movements: number;
    suppliers: number;
    users: number;
  };
  error?: string;
};

function formatBackupTimestamp(value: string | null): string {
  if (!value) {
    return "No backup recorded";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function DatabaseSettingsForm() {
  const { toast } = useToast();
  const isElectron = isElectronEnvironment();
  const electronBridge = useMemo(() => new ElectronBridge(), []);

  const databaseInfo = useQuery<DesktopDatabaseInfo>({
    queryKey: ["desktop-database-info"],
    queryFn: () => electronBridge.getDatabaseInfo<DesktopDatabaseInfo>(),
    enabled: isElectron,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  const refreshStatus = async () => {
    const result = await databaseInfo.refetch();
    if (result.error) {
      toast({
        title: "Database status check failed",
        description: result.error instanceof Error ? result.error.message : "Unable to load local database status.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Database status refreshed",
      description: "Desktop storage health and backup metadata were reloaded.",
    });
  };

  const createBackup = useMutation({
    mutationFn: () => electronBridge.createDatabaseBackup<{ success: boolean; path?: string; error?: string }>(),
    onSuccess: async (result) => {
      if (!result?.success) {
        toast({
          title: "Backup failed",
          description: result?.error || "Local backup could not be created.",
          variant: "destructive",
        });
        return;
      }

      await databaseInfo.refetch();
      toast({
        title: "Backup created",
        description: result.path || "A local backup file was created successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Backup failed",
        description: error instanceof Error ? error.message : "Local backup could not be created.",
        variant: "destructive",
      });
    },
  });

  const syncDatabase = useMutation({
    mutationFn: () => electronBridge.syncDatabase<{ success?: boolean; error?: string } | boolean>(),
    onSuccess: async (result) => {
      const ok = typeof result === "boolean" ? result : result?.success !== false;
      if (!ok) {
        toast({
          title: "Sync failed",
          description: typeof result === "object" && result?.error ? result.error : "Desktop sync did not complete.",
          variant: "destructive",
        });
        return;
      }

      await databaseInfo.refetch();
      toast({
        title: "Sync completed",
        description: "Local desktop storage finished its sync cycle.",
      });
    },
    onError: (error) => {
      toast({
        title: "Sync failed",
        description: error instanceof Error ? error.message : "Desktop sync did not complete.",
        variant: "destructive",
      });
    },
  });

  if (!isElectron) {
    return (
      <Card data-testid="database-settings-web-only">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            Desktop Database Operations
          </CardTitle>
          <CardDescription>
            This browser build does not have access to local database controls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-300/70 bg-amber-50/80 p-4 text-sm text-amber-950">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Honest scope
            </div>
            <p className="mt-2">
              Local connection details, offline sync policy, and backup actions belong to the packaged desktop app. This page no longer pretends to save database credentials through shared organization settings.
            </p>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="database-settings-unsupported-config">
            Use the desktop shell for local backup, sync, and storage diagnostics. Organization-level settings remain on the other settings tabs where server enforcement exists.
          </p>
        </CardContent>
      </Card>
    );
  }

  const info = databaseInfo.data;
  const status = info?.status ?? "error";
  const statusLabel = status === "healthy" ? "Healthy" : status === "degraded" ? "Degraded" : "Error";
  const stats = info?.dataCount ?? { inventory: 0, movements: 0, suppliers: 0, users: 0 };
  const busy = createBackup.isPending || syncDatabase.isPending;

  return (
    <Card data-testid="database-settings-desktop">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Desktop Database Operations
        </CardTitle>
        <CardDescription>
          Real desktop-only controls for local storage health, backup evidence, and manual sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status === "healthy" ? "default" : status === "degraded" ? "outline" : "destructive"}>
            {statusLabel}
          </Badge>
          <Badge variant="outline">{info?.size ?? "Unknown size"}</Badge>
          <Badge variant="outline">Last backup: {formatBackupTimestamp(info?.lastBackup ?? null)}</Badge>
        </div>

        {databaseInfo.isLoading ? (
          <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading local database status...
          </div>
        ) : null}

        {databaseInfo.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" data-testid="database-settings-error">
            Failed to load desktop database status. Retry before running backup or sync actions.
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Inventory rows</div>
            <div className="mt-2 text-2xl font-semibold">{stats.inventory}</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Stock movements</div>
            <div className="mt-2 text-2xl font-semibold">{stats.movements}</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Suppliers</div>
            <div className="mt-2 text-2xl font-semibold">{stats.suppliers}</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Users</div>
            <div className="mt-2 text-2xl font-semibold">{stats.users}</div>
          </div>
        </div>

        <div className="rounded-lg border p-4" data-testid="database-settings-panel">
          <div className="flex items-start gap-3">
            <HardDrive className="mt-0.5 h-4 w-4 text-primary" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Fail-closed configuration boundary</p>
              <p className="text-muted-foreground">
                Connection endpoints and credentials are not editable from this renderer screen because there is no server-enforced or encrypted org-wide persistence path for them here.
              </p>
              <p className="text-muted-foreground">
                Supported actions on this route are limited to desktop health inspection, local backup creation, and explicit sync execution through Electron IPC.
              </p>
              <code className="block break-all rounded bg-muted px-3 py-2 text-xs">
                {info?.location ?? "Local database path unavailable"}
              </code>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={refreshStatus} disabled={databaseInfo.isFetching || busy}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh status
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => createBackup.mutate()} disabled={busy}>
            <Download className="mr-2 h-4 w-4" />
            {createBackup.isPending ? "Creating backup..." : "Create backup"}
          </Button>
          <Button type="button" onClick={() => syncDatabase.mutate()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {syncDatabase.isPending ? "Syncing..." : "Run sync"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
