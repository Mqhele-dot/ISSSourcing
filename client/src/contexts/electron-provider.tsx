import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { electron, isElectronEnvironment } from '@/lib/electron-bridge';

interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version: string | null;
  downloading: boolean;
  downloadProgress: number | null;
  error: string | null;
  releaseNotes?: string[];
}

interface AppControls {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  restoreWindow: () => void;
  closeWindow: () => void;
  toggleMaximize: () => void;
}

interface UpdateActions {
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
}

interface ElectronContextValue {
  isElectron: boolean;
  isMaximized: boolean;
  platform: string;
  appVersion: string | null;
  appControls: AppControls | null;
  updateStatus: UpdateStatus;
  updateActions: UpdateActions | null;
}

const defaultUpdateStatus: UpdateStatus = {
  state: 'idle',
  version: null,
  downloading: false,
  downloadProgress: null,
  error: null
};

export const ElectronContext = createContext<ElectronContextValue | null>(null);

/**
 * Provider component that makes electron functionality available
 * to any child component that calls the useElectron() hook.
 */
export function ElectronProvider({ children }: { children: ReactNode }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState('');
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(defaultUpdateStatus);
  
  useEffect(() => {
    if (!isElectronEnvironment()) return;

    // Get system info
    electron.getSystemInfo().then((info) => {
      setPlatform(info.platform);
      setIsMaximized(info.isMaximized);
      setAppVersion(info.appVersion);
    });

    // Listen for window maximize/unmaximize events
    const unsubMaximize = electron.receive('window:maximized', () => {
      setIsMaximized(true);
    });
    
    const unsubUnmaximize = electron.receive('window:unmaximized', () => {
      setIsMaximized(false);
    });
    
    // Listen for update status changes
    const unsubUpdateStatus = electron.receive('updates:status', (status: UpdateStatus) => {
      setUpdateStatus(status);
    });
    
    return () => {
      unsubMaximize();
      unsubUnmaximize();
      unsubUpdateStatus();
    };
  }, []);
  
  // App window controls
  const appControls: AppControls | null = isElectronEnvironment() ? {
    minimizeWindow: () => electron.send('window:minimize'),
    maximizeWindow: () => electron.send('window:maximize'),
    restoreWindow: () => electron.send('window:restore'),
    closeWindow: () => electron.send('window:close'),
    toggleMaximize: () => electron.send(isMaximized ? 'window:restore' : 'window:maximize')
  } : null;
  
  // Update controls
  const updateActions: UpdateActions | null = isElectronEnvironment() ? {
    checkForUpdates: () => electron.send('updates:check'),
    downloadUpdate: () => electron.send('updates:download'),
    installUpdate: () => electron.send('updates:install')
  } : null;
  
  const value: ElectronContextValue = {
    isElectron: isElectronEnvironment(),
    isMaximized,
    platform,
    appVersion,
    appControls,
    updateStatus,
    updateActions
  };
  
  return (
    <ElectronContext.Provider value={value}>
      {children}
    </ElectronContext.Provider>
  );
}

/**
 * Hook that provides access to the electron context
 */
export function useElectron() {
  const context = useContext(ElectronContext);
  if (context === null) {
    throw new Error('useElectron must be used within an ElectronProvider');
  }
  return context;
}