import React, { ReactNode } from 'react';
import { TitleBar } from '@/components/electron/title-bar';
import { UpdateNotification } from '@/components/electron/update-notification';
import { useElectron } from '@/contexts/electron-provider';

interface DesktopLayoutProps {
  children: ReactNode;
}

/**
 * Layout component for desktop application
 * 
 * This component adds the custom title bar and handles the desktop-specific
 * layout adjustments. It should wrap the entire application when running
 * in Electron environment.
 */
export function DesktopLayout({ children }: DesktopLayoutProps) {
  const { isElectron } = useElectron();
  
  if (!isElectron) {
    return <>{children}</>;
  }
  
  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden">
      <TitleBar />
      <div className="flex-1 overflow-auto">
        {children}
      </div>
      <UpdateNotification />
    </div>
  );
}