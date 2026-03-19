import React, { useState } from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { TitleBar } from '../electron';
import { OfflineModeIndicator } from '../electron/offline-mode-indicator';
import Sidebar from '../sidebar';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorialButton } from '@/components/tutorial/tutorial-button';
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

  return (
    <div className="app-shell flex flex-col min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none"
      >
        Skip to main content
      </a>
      <CommandMenu />
      {isElectron && <TitleBar title={title} />}
      
      <div className="flex flex-1">
        {/* Sidebar */}
        <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
        
        {/* Main content */}
        <div className="flex-1 relative flex flex-col">
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
          
          <main id="main-content" className="flex-1 p-4 md:p-6 relative" tabIndex={-1}>
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