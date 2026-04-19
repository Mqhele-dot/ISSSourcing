import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { resolveShell } from "@/lib/layout/resolve-shell";
import { DesktopLayout } from "@/components/layout/desktop-layout";
import { MobileLayout } from "@/components/layout/mobile-layout";
import { UpdateNotification } from "@/components/electron";
import { ProductOnboardingGate } from "@/components/setup/product-onboarding-gate";

export function AppShellLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const layout = resolveShell(loc);
  if (layout.shell === "mobile") {
    return (
      <MobileLayout>
        <UpdateNotification />
        <ProductOnboardingGate>{children}</ProductOnboardingGate>
      </MobileLayout>
    );
  }
  return (
    <DesktopLayout>
      <UpdateNotification />
      <ProductOnboardingGate>{children}</ProductOnboardingGate>
    </DesktopLayout>
  );
}
