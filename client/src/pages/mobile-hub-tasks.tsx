import { Link } from "wouter";
import { ClipboardList, RefreshCw, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export default function MobileHubTasksPage() {
  return (
    <div className="space-y-4 p-4" data-testid="mobile-hub-tasks-page">
      <PageHeader title="Task list" description="Operational shortcuts" />
      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href={APP_ROUTES.operations.mobileCounts}>
            <ClipboardList className="h-5 w-5" />
            <span>Mobile stock counts</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href={APP_ROUTES.inventory.reorder}>
            <RefreshCw className="h-5 w-5" />
            <span>Reorder requests</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href={APP_ROUTES.operations.mobilePick}>
            <Smartphone className="h-5 w-5" />
            <span>Mobile pick</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
