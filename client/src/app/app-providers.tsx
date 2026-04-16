import type { ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { AccentProvider } from "@/components/accent-provider";
import { DensityProvider } from "@/components/density-provider";
import { TutorialProvider } from "@/contexts/tutorial-context";
import { HelpExplainProvider } from "@/contexts/help-explain-context";
import { AuthProvider } from "@/hooks/use-auth";
import { ElectronProvider } from "@/contexts/electron-provider";
import { OfflineSyncBridge } from "@/components/offline-sync-bridge";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="invtrack-theme">
      <DensityProvider>
        <AccentProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <OfflineSyncBridge />
              <TutorialProvider>
                <HelpExplainProvider>
                  <ElectronProvider>{children}</ElectronProvider>
                </HelpExplainProvider>
              </TutorialProvider>
            </AuthProvider>
          </QueryClientProvider>
        </AccentProvider>
      </DensityProvider>
    </ThemeProvider>
  );
}
