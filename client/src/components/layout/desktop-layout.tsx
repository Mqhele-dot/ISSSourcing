import React from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { TitleBar } from '../electron';
import { OfflineModeIndicator } from '../electron/offline-mode-indicator';

interface DesktopLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({ 
  children, 
  title
}) => {
  const { isElectron } = useElectron();

  return (
    <div className="flex flex-col min-h-screen">
      {isElectron && <TitleBar title={title} />}
      {isElectron && <OfflineModeIndicator />}
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
};