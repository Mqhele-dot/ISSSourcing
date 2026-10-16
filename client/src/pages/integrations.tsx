import { PlugZap } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="integrations-page">
      <PageHeader
        title="Integrations"
        subtitle="External connector configuration and operational status"
        breadcrumb={<span>Admin / Integrations</span>}
      />

      <Card data-tour="integrations-connectors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="h-5 w-5" />
            No connector runtime configured
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            ERP, WMS, and TMS executors are not configured for this deployment. The previous manual-run controls only
            generated success records and did not exchange data with an external system, so they have been removed.
          </p>
          <p>
            Add this surface back when a connector has a real adapter, tenant-scoped credentials, connection testing,
            failure reporting, and an auditable synchronization contract.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
