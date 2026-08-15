import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggleButton({ compact = false, collapsed = false, className }: { compact?: boolean; collapsed?: boolean; className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const nextLabel = resolvedTheme === "dark" ? "Light Mode" : "Dark Mode";
  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "default"}
      className={className}
      aria-label={compact ? "Toggle theme" : nextLabel}
      onClick={toggleTheme}
    >
      {resolvedTheme === "dark" ? <Sun className={cn("h-5 w-5", !compact && !collapsed && "mr-2")} /> : <Moon className={cn("h-5 w-5", !compact && !collapsed && "mr-2")} />}
      {compact ? null : <span className={cn(collapsed && "md:sr-only")}>{nextLabel}</span>}
    </Button>
  );
}
