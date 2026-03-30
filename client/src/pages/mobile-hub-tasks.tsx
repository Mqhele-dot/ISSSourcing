import { Link } from "wouter";
import { ClipboardList, RefreshCw, Smartphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function MobileHubTasksPage() {
  return (
    <div className="space-y-4 p-4">
      <PageHeader title="Task list" description="Operational shortcuts" />
      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href="/cycle-counts">
            <ClipboardList className="h-5 w-5" />
            <span>Cycle counts</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href="/reorder">
            <RefreshCw className="h-5 w-5" />
            <span>Reorder requests</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href="/mobile/pick">
            <Smartphone className="h-5 w-5" />
            <span>Mobile pick</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
