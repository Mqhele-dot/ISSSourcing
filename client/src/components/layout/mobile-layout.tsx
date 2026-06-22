import React from "react";
import { Link, useLocation } from "wouter";
import { Home, ClipboardList, QrCode, CheckSquare, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/m/home", label: "Home", icon: Home },
  { href: "/m/counts", label: "Count", icon: ClipboardList },
  { href: "/m/scan", label: "Scan", icon: QrCode },
  { href: "/m/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/m/more", label: "More", icon: Menu },
] as const;

export function MobileLayout({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[4.5rem]">{children}</main>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-md"
        aria-label="Mobile primary"
      >
        {nav.map(({ href, label, icon: Icon }) => {
          const active = loc === href || (href !== "/m/home" && loc.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="truncate px-0.5">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
