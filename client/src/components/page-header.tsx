import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: ReactNode;
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
}: PageHeaderProps) {
  const hasLegacyActions = action || secondaryAction;

  return (
    <div className="space-y-4">
      {breadcrumb ? <div className="text-xs text-muted-foreground">{breadcrumb}</div> : null}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon && <div className="h-8 w-8">{icon}</div>}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
            {description && (
              <p className="text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        
        {actions ? (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">{actions}</div>
        ) : hasLegacyActions ? (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
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