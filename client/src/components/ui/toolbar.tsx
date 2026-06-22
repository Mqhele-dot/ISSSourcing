import type React from "react";
import { cn } from "@/lib/utils";

type ToolbarProps = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  sticky?: boolean;
};

export function Toolbar({ left, right, className, sticky = false }: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center md:gap-3",
        sticky && "sticky top-16 z-20",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{left}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>
    </div>
  );
}
