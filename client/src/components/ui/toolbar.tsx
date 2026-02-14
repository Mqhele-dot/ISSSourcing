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
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center md:justify-between",
        sticky && "sticky top-16 z-20",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">{left}</div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">{right}</div>
    </div>
  );
}
