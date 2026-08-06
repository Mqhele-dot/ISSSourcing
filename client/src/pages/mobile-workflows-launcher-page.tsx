import { Link, Redirect } from "wouter";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PHONE_OPERATIONS_MEDIA_QUERY, phoneOperationsTarget } from "@/lib/layout/phone-operations-entry";
import MobileHubTasksPage from "@/pages/mobile-hub-tasks";

const mobileRoutes: { href: string; title: string; description: string }[] = [
  { href: APP_ROUTES.operations.mobileHub, title: "Operations", description: "Unified phone dashboard and live work queues." },
  { href: APP_ROUTES.operations.mobileCounts, title: "Count", description: "Tenant warehouse stock counts." },
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
  const isPhone = useMediaQuery(PHONE_OPERATIONS_MEDIA_QUERY);
  if (isPhone) {
    return <Redirect to={phoneOperationsTarget(typeof window === "undefined" ? "" : window.location.search)} />;
  }

  return (
    <PageShell>
      <PageHeader
        title="Mobile workflows"
        subtitle="Live phone preview and explicit testing links for frontline workflows."
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

      <section aria-labelledby="phone-preview-title" className="mx-auto w-full max-w-[430px] rounded-[2rem] border-8 border-foreground/80 bg-background shadow-xl">
        <div className="mx-auto mt-2 h-1.5 w-20 rounded-full bg-foreground/70" />
        <div className="max-h-[680px] overflow-y-auto overscroll-contain rounded-[1.5rem]" data-testid="phone-workflow-preview">
          <MobileHubTasksPage preview />
        </div>
        <h2 id="phone-preview-title" className="sr-only">Live Operations phone dashboard preview</h2>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {mobileRoutes.map(({ href, title, description }) => (
          <Card key={href}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full sm:w-auto">
                <Link href={href}>Open {title} in this browser</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
