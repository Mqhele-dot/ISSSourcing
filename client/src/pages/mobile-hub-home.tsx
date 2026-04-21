import { useEffect } from "react";
import { Link } from "wouter";
import { AlertTriangle, PackageCheck, QrCode, Truck } from "lucide-react";
import { flushOfflineQueueToServer } from "@/lib/offline-queue";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Button } from "@/components/ui/button";

const tiles = [
  { href: APP_ROUTES.operations.exceptions, title: "Exceptions", desc: "Open issues", icon: AlertTriangle },
  { href: APP_ROUTES.operations.mobileReceive, title: "Receive", desc: "Goods receipt", icon: PackageCheck },
  { href: APP_ROUTES.operations.mobileScan, title: "Scan", desc: "Barcode / QR", icon: QrCode },
  { href: APP_ROUTES.operations.logistics, title: "Shipments", desc: "In transit", icon: Truck },
] as const;

/** Mobile-first task hub (paired with bottom nav in `MobileLayout`). */
export default function MobileHubHomePage() {
  useEffect(() => {
    const onOnline = () => {
      void flushOfflineQueueToServer();
    };
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void flushOfflineQueueToServer();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <div className="space-y-4 p-4">
      <PageHeader title="Tasks" description="Quick access to warehouse and approval flows" />
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ href, title, desc, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:bg-accent/40">
              <CardContent className="flex flex-col gap-2 p-4">
                <Icon className="h-8 w-8 text-primary" />
                <p className="font-semibold leading-tight">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="pt-2">
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={APP_ROUTES.operations.root}>Desktop operations overview</Link>
        </Button>
      </div>
    </div>
  );
}
