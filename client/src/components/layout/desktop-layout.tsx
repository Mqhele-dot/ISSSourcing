import React, { ReactNode } from 'react';
import { useElectron } from '@/contexts/electron-provider';
import { TitleBar, UpdateNotification } from '@/components/electron';

interface DesktopLayoutProps {
  children: ReactNode;
  title?: string;
}

/**
 * Desktop Layout for Electron Application
 * 
 * This layout wraps the application with Electron-specific components like the custom
 * title bar and update notification. It only renders these components when running in
 * an Electron environment, falling back to rendering just the children in a browser.
 */
export function DesktopLayout({ children, title = 'InvTrack' }: DesktopLayoutProps) {
  const { isElectron } = useElectron();
  
  // If not in Electron, just render the children
  if (!isElectron) {
    return <>{children}</>;
  }
  
  return (
    <div className="flex flex-col h-screen">
      {/* Custom titlebar for the Electron window */}
      <TitleBar title={title} />
      
      {/* Main content area */}
      <div className="flex-1 overflow-auto">
        {/* Update notification */}
        <div className="container mx-auto p-4">
          <UpdateNotification />
        </div>
        
        {/* Render the children components */}
        {children}
      </div>
    </div>
  );
}