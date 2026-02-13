import React, { useState } from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { TitleBar } from '../electron';
import { OfflineModeIndicator } from '../electron/offline-mode-indicator';
import Sidebar from '../sidebar';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorialButton } from '@/components/tutorial/tutorial-button';
import { Header } from './header';

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
    <div className="flex flex-col min-h-screen">
      {isElectron && <TitleBar title={title} />}
      
      <div className="flex flex-1">
        {/* Sidebar */}
        <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
        
        {/* Main content */}
        <div className="flex-1 relative flex flex-col">
          {/* Header with profile icon */}
          <Header />
          
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
          
          <main className="flex-1 p-4 md:p-6 relative">
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