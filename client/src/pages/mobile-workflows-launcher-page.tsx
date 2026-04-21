import { Link } from "wouter";
import { ArrowLeft, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";

const mobileRoutes: { href: string; title: string; description: string }[] = [
  { href: APP_ROUTES.operations.mobileHub, title: "Mobile home", description: "Task hub and quick links (mobile shell)." },
  { href: APP_ROUTES.operations.mobileTasks, title: "Tasks", description: "Prioritized task list for frontline work." },
  { href: APP_ROUTES.operations.mobileScan, title: "Scan", description: "Barcode and QR scanning flows." },
  { href: APP_ROUTES.operations.mobileApprovals, title: "Approvals", description: "Purchase and approval actions." },
  { href: APP_ROUTES.operations.mobileMore, title: "More", description: "Additional mobile tools and settings." },
  { href: APP_ROUTES.operations.mobileReceive, title: "Receive", description: "Goods receipt and put-away handoff." },
  { href: APP_ROUTES.operations.mobilePick, title: "Pick", description: "Picking and allocation execution." },
];

/**
 * Desktop entry that explains the switch to the mobile workflow shell (`/m/*`).
 * Keeps primary navigation desktop-first; users opt in here.
 */
export default function MobileWorkflowsLauncherPage() {
  return (
    <PageShell>
      <PageHeader
        title="Mobile workflows"
        subtitle="Frontline tools run in a dedicated mobile layout—not the standard desktop sidebar."
        breadcrumb={
          <span className="flex flex-wrap items-center gap-1">
            <Link href={APP_ROUTES.operations.root} className="text-primary hover:underline">
              Operations
            </Link>
            <span className="text-muted-foreground">/</span>
            <span>Mobile workflows</span>
          </span>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={APP_ROUTES.operations.root}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to operations
            </Link>
          </Button>
        }
      />

      <Alert>
        <Smartphone className="h-4 w-4" />
        <AlertTitle>You are about to open the mobile workflow shell</AlertTitle>
        <AlertDescription className="text-sm">
          Routes under <code className="rounded bg-muted px-1">/m/…</code> use the mobile layout (bottom navigation,
          full-width task screens). Use this when you are on a phone, tablet, or want the simplified frontline
          experience. To return to desktop modules, use your browser back button or navigate to Operations again from
          the menu after switching back to a wide window.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2">
        {mobileRoutes.map(({ href, title, description }) => (
          <Card key={href}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full sm:w-auto">
                <Link href={href}>Open mobile shell — {title}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
