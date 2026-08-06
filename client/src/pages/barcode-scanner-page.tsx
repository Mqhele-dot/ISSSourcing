import React, { Suspense, useCallback, useState } from "react";
import { Link } from "wouter";
import { BarcodeScanner } from "@/components/barcode/barcode-scanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ScanResult } from "@/hooks/use-barcode-scanner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QrCode, Barcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RealTimeUpdates } from "@/components/real-time-updates";
import { enqueueOfflineAction } from "@/lib/offline-queue";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { resolveMobileScan, type MobileScanResolveResult } from "@/api/client";
import { APP_ROUTES } from "@/lib/routes/app-routes";

const BarcodeGenerator = React.lazy(() =>
  import("@/components/barcode/barcode-generator").then((module) => ({ default: module.BarcodeGenerator })),
);

function ResolutionActions({ result }: { result: MobileScanResolveResult }) {
  if (result.kind === "item") {
    return (
      <>
        <div>
          <p className="text-sm font-medium">{result.item?.name ?? "Inventory item"}</p>
          <p className="text-sm text-muted-foreground">SKU {result.item?.sku ?? result.barcode.value}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.item ? (
            <Button asChild size="sm" variant="outline">
              <Link href={APP_ROUTES.inventory.item(result.item.sku)}>Open item</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={APP_ROUTES.operations.mobileCounts}>Count</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={APP_ROUTES.operations.mobileReceive}>Receive</Link>
          </Button>
        </div>
      </>
    );
  }

  if (result.kind === "asset") {
    return (
      <>
        <div>
          <p className="text-sm font-medium">{result.asset.assetType}</p>
          <p className="text-sm text-muted-foreground">
            Serial {result.asset.serialNumber ?? "not set"} - Status {result.asset.status ?? "unknown"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={APP_ROUTES.inventory.warehouseOperations}>Warehouse ops</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={APP_ROUTES.operations.exceptions}>Exceptions</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        No item or tracked asset is linked to <span className="font-medium text-foreground">{result.value}</span>.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={APP_ROUTES.admin.masterData}>Open master data</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={APP_ROUTES.inventory.barcodeScanner}>Manage barcodes</Link>
        </Button>
      </div>
    </>
  );
}

export default function BarcodeScannerPage() {
  const [tab, setTab] = useState("scan");
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [latestResolution, setLatestResolution] = useState<MobileScanResolveResult | null>(null);
  const { toast } = useToast();

  const handleScan = useCallback(async (result: ScanResult) => {
    setScanHistory((prevHistory) => [result, ...prevHistory]);
    const value = result.text.trim();
    const queuedPayload = {
      value,
      intent: "scan",
      format: result.format,
      deviceId: "browser-mobile",
    };

    toast({
      title: "Scan captured",
      description: `Resolving code: ${value}`,
    });

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;

    if (offline) {
      await enqueueOfflineAction("scan", queuedPayload);
      toast({
        title: "Offline - scan queued",
        description: "The canonical mobile scan payload will replay when the device reconnects.",
      });
      return;
    }

    try {
      const resolved = await resolveMobileScan({ value, intent: "scan" });
      setLatestResolution(resolved);
      toast({
        title: resolved.kind === "unknown" ? "Scan needs follow-up" : "Scan resolved",
        description:
          resolved.kind === "item"
            ? `Matched item ${resolved.item?.sku ?? resolved.barcode.value}.`
            : resolved.kind === "asset"
              ? `Matched asset ${resolved.asset.serialNumber ?? resolved.asset.id}.`
              : `No linked record found for ${resolved.value}.`,
      });
    } catch {
      await enqueueOfflineAction("scan", queuedPayload);
      toast({
        title: "Queued for retry",
        description: "Could not resolve the scan live; the mobile scan payload was queued for replay.",
      });
    }
  }, [toast]);

  const clearHistory = () => {
    setScanHistory([]);
  };

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6" data-testid="barcode-scanner-page">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Barcode & QR Scanner</h1>

      <ModuleTrainingPanel moduleId="barcode-scanner" />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">
                <QrCode className="mr-2 h-4 w-4" />
                Scan Code
              </TabsTrigger>
              <TabsTrigger value="generate">
                <Barcode className="mr-2 h-4 w-4" />
                Generate Code
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scan">
              <BarcodeScanner onScan={handleScan} />
            </TabsContent>

            <TabsContent value="generate">
              <Suspense
                fallback={
                  <Card className="mx-auto w-full max-w-md">
                    <CardContent className="p-8 text-center text-sm text-muted-foreground">
                      Loading code generator...
                    </CardContent>
                  </Card>
                }
              >
                <BarcodeGenerator />
              </Suspense>
            </TabsContent>
          </Tabs>

          <Alert>
            <AlertTitle>How it works</AlertTitle>
            <AlertDescription>
              {tab === "scan" ? (
                <p>
                  This scanner resolves against the mobile scan contract, so live scans return the same item or asset
                  hints used by the frontline shell and queued scans replay through offline sync.
                </p>
              ) : (
                <p>
                  Enter a value to generate a barcode or QR code. You can download, print, or copy the generated code
                  for use in your inventory system.
                </p>
              )}
            </AlertDescription>
          </Alert>

          {latestResolution ? (
            <Card data-testid="mobile-scan-latest-resolution">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>Latest scan resolution</span>
                  <Badge variant={latestResolution.kind === "unknown" ? "secondary" : "default"}>
                    {latestResolution.kind}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ResolutionActions result={latestResolution} />
                <div className="flex flex-wrap gap-2">
                  {latestResolution.nextActions.map((action) => (
                    <Badge key={action} variant="secondary">
                      {action.replaceAll("_", " ")}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Scan History</span>
                {scanHistory.length > 0 ? (
                  <Button variant="outline" size="sm" onClick={clearHistory}>
                    Clear
                  </Button>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scanHistory.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <QrCode className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                  <p>No scans yet. Scan a barcode or QR code to see live mobile resolution results here.</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-3">
                    {scanHistory.map((scan, index) => (
                      <Card key={index} className="border border-muted p-3">
                        <div className="flex items-start gap-3">
                          <div className="rounded-full bg-primary/10 p-2 text-primary">
                            {scan.format.includes("QR") ? (
                              <QrCode className="h-4 w-4" />
                            ) : (
                              <Barcode className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{scan.text}</p>
                            <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                              <span>{scan.format}</span>
                              <span>|</span>
                              <span>{new Date(scan.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-2 lg:col-span-1 lg:self-start">
          <RealTimeUpdates cardClassName="lg:max-h-[min(36rem,calc(100dvh-9rem))]" />
        </div>
      </div>
    </div>
  );
}
