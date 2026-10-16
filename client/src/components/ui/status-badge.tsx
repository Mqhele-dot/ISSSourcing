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
  in_transit: "info",
  late: "warning",
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

/** Human-readable label while keeping raw value for variant matching */
function formatStatusLabel(status: string): string {
  const s = status.trim();
  if (!s) return "—";
  return s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
      {formatStatusLabel(status)}
    </Badge>
  );
}
