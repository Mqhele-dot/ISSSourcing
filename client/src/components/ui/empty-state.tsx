import type React from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Optional test id for e2e / diagnostics (e.g. entity-activity-empty). */
  testId?: string;
};

export function EmptyState({ icon, title, description, action, className, testId }: EmptyStateProps) {
  return (
    <div className={cn("empty-state", className)} data-testid={testId}>
      {icon ? <div className="empty-state__icon">{icon}</div> : null}
      <h2 className="text-xl font-semibold">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground max-w-md">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
