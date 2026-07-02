import { Link } from "wouter";
import { CheckCheck, ClipboardList, FileStack, ReceiptText, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_ROUTES } from "@/lib/routes/app-routes";

const approvalDestinations = [
  {
    href: APP_ROUTES.finance.accountsPayableApprovals,
    title: "AP approvals",
    description: "Review invoice and payment approvals from the finance queue.",
    icon: ReceiptText,
  },
  {
    href: APP_ROUTES.procurement.orders,
    title: "Purchase orders",
    description: "Approve or review supplier purchase orders and receiving exceptions.",
    icon: ClipboardList,
  },
  {
    href: APP_ROUTES.procurement.requisitions,
    title: "Requisitions",
    description: "Clear demand requests before they become purchase orders.",
    icon: FileStack,
  },
  {
    href: APP_ROUTES.finance.approvalPolicies,
    title: "Approval policies",
    description: "Open the desktop policy center when thresholds or approvers need changes.",
    icon: Settings2,
  },
] as const;

export default function MobileApprovalsPage() {
  return (
    <div className="space-y-4 p-4" data-testid="mobile-approvals-page">
      <PageHeader
        title="Approvals"
        description="Mobile shortcuts into procurement and AP approval queues without the desktop tab shell."
      />
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCheck className="h-4 w-4 text-primary" />
            Clear priority approvals faster
          </CardTitle>
          <CardDescription>
            Use AP approvals for invoice and payment actions. Open procurement queues when a supplier order or
            requisition needs approval before warehouse work can continue.
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="grid gap-3">
        {approvalDestinations.map(({ href, title, description, icon: Icon }) => (
          <Button key={href} asChild variant="outline" className="h-auto justify-start px-4 py-4 text-left">
            <Link href={href}>
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <CardContent className="space-y-1 p-0">
                  <p className="font-semibold leading-tight">{title}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </div>
            </Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
