import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusVariant = "success" | "warning" | "error" | "info" | "neutral";

const statusMap: Record<string, StatusVariant> = {
  active: "success",
  healthy: "success",
  connected: "success",
  open: "info",
  approved: "info",
  sent: "info",
  received: "success",
  delivered: "success",
  low: "warning",
  pending: "warning",
  draft: "neutral",
  disconnected: "error",
  error: "error",
  failed: "error",
  cancelled: "error",
};

function toVariant(status: string): StatusVariant {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  return statusMap[normalized] ?? "neutral";
}

const variantClassName: Record<StatusVariant, string> = {
  success: "status-badge--success",
  warning: "status-badge--warning",
  error: "status-badge--error",
  info: "status-badge--info",
  neutral: "border-border bg-muted text-foreground",
};

type StatusBadgeProps = {
  status: string;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = toVariant(status);
  return (
    <Badge variant="outline" className={cn(variantClassName[variant], className)}>
      {status}
    </Badge>
  );
}
