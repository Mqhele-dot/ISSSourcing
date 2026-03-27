import React, { useEffect, useState } from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { TitleBar } from '../electron';
import { OfflineModeIndicator } from '../electron/offline-mode-indicator';
import Sidebar from '../sidebar';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorialButton } from '@/components/tutorial/tutorial-button';
import { TutorialPageHint } from '@/components/tutorial/tutorial-page-hint';
import { Header } from './header';
import { FallbackBanner } from '@/components/fallback-banner';
import { CommandMenu } from '@/components/command-menu';

interface DesktopLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({ 
  children, 
  title
}) => {
  const { isElectron } = useElectron();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem("invtrack-sidebar-collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("invtrack-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  return (
    <div className="app-shell flex min-h-0 flex-1 flex-col overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none"
      >
        Skip to main content
      </a>
      <CommandMenu />
      {isElectron && <TitleBar title={title} />}
      
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          setOpen={setSidebarOpen}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
        />
        
        {/* Main content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col relative">
          {/* Header with profile icon */}
          <Header />

          {/* Degraded mode banner when operational fallback is active */}
          <FallbackBanner />
          
          {/* Mobile menu button */}
          <div className="block md:hidden absolute top-4 left-4 z-30">
            <Button 
              variant="outline" 
              size="icon" 
              className="shadow-md"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
          
          {isElectron && <OfflineModeIndicator />}
          
          <main
            id="main-content"
            className="relative flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-4 md:p-6"
            tabIndex={-1}
          >
            <TutorialPageHint />
            {children}
          </main>
          
          {/* Tutorial Button - Fixed at the bottom right */}
          <div className="fixed bottom-6 right-6 z-50">
            <TutorialButton />
          </div>
        </div>
      </div>
    </div>
  );
};