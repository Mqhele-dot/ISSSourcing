import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { resolveShell } from "@/lib/layout/resolve-shell";
import { DesktopLayout } from "@/components/layout/desktop-layout";
import { MobileLayout } from "@/components/layout/mobile-layout";
import { UpdateNotification } from "@/components/electron";
import { ProductOnboardingGate } from "@/components/setup/product-onboarding-gate";
import { APP_ROUTES } from "@/lib/routes/app-routes";

function pathWithoutQuery(path: string): string {
  const i = path.indexOf("?");
  return i === -1 ? path : path.slice(0, i);
}

export function AppShellLayout({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  /** Auth uses a full-screen page without desktop/mobile chrome; gate still wraps children for consistent providers. */
  if (pathWithoutQuery(loc) === APP_ROUTES.auth) {
    return (
      <>
        <UpdateNotification />
        <ProductOnboardingGate>{children}</ProductOnboardingGate>
      </>
    );
  }

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
