import React, { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: ReactElement | ComponentType<{ className?: string }> | LucideIcon;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  action?: {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  };
  secondaryAction?: {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  };
  /** Optional stable selector for E2E / external testers (e.g. `"page-title"`). */
  titleTestId?: string;
  headingLevel?: 1 | 2;
}

export function PageHeader({
  title,
  subtitle,
  description,
  icon,
  breadcrumb,
  actions,
  action,
  secondaryAction,
  titleTestId,
  headingLevel = 1,
}: PageHeaderProps) {
  const hasLegacyActions = action || secondaryAction;
  const renderIcon = (): ReactNode => {
    if (!icon) return null;
    if (isValidElement(icon)) return icon;

    // Lucide icons are React.forwardRef objects, not plain functions. Creating
    // the element also supports ordinary component types without rendering the
    // component object itself as a React child (React error #31).
    return createElement(icon as ComponentType<{ className?: string }>, {
      className: "h-8 w-8",
    });
  };

  return (
    <div className="space-y-4">
      {breadcrumb ? <div className="text-xs text-muted-foreground">{breadcrumb}</div> : null}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <div className="h-8 w-8">{renderIcon()}</div> : null}
          <div className="min-w-0">
            {createElement(headingLevel === 1 ? "h1" : "h2", {
              className: "text-2xl font-bold tracking-tight",
              "data-testid": titleTestId ?? undefined,
            }, title)}
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
            {description && (
              <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        
        {actions ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:shrink-0 lg:justify-end">{actions}</div>
        ) : hasLegacyActions ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:shrink-0 lg:justify-end">
            {secondaryAction && (
              <Button
                variant="outline"
                onClick={secondaryAction.onClick}
                disabled={secondaryAction.disabled}
              >
                {secondaryAction.icon && (
                  <span className="mr-2">{secondaryAction.icon}</span>
                )}
                {secondaryAction.label}
              </Button>
            )}
            
            {action && (
              <Button 
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.icon && (
                  <span className="mr-2">{action.icon}</span>
                )}
                {action.label}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <Separator />
    </div>
  );
}
