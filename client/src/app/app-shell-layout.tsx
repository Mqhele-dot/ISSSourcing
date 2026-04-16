import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { resolveShell } from "@/lib/layout/resolve-shell";
import { DesktopLayout } from "@/components/layout/desktop-layout";
import { MobileLayout } from "@/components/layout/mobile-layout";
import { UpdateNotification } from "@/components/electron";

export function AppShellLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const layout = resolveShell(loc);
  if (layout.shell === "mobile") {
    return (
      <MobileLayout>
        <UpdateNotification />
        {children}
      </MobileLayout>
    );
  }
  return (
    <DesktopLayout>
      <UpdateNotification />
      {children}
    </DesktopLayout>
  );
}
