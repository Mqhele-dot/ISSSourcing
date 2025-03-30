import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { electron, isElectronEnvironment } from '@/lib/electron-bridge';
import { useToast } from '@/hooks/use-toast';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface ElectronContextValue {
  isElectron: boolean;
  isMaximized: boolean;
  updateAvailable: boolean;
  updateDownloaded: boolean;
  updateInfo: UpdateInfo | null;
  appVersion: string;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  unmaximizeWindow: () => void;
  closeWindow: () => void;
  setWindowTitle: (title: string) => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  createBackup: (customPath?: string) => Promise<string>;
  restoreBackup: (backupPath: string) => Promise<boolean>;
  openFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
  saveFile: (defaultPath?: string, filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
  showMessageBox: (options: any) => Promise<{ response: number; checkboxChecked: boolean }>;
}

// Default context value (used for non-Electron environments)
const defaultContextValue: ElectronContextValue = {
  isElectron: false,
  isMaximized: false,
  updateAvailable: false,
  updateDownloaded: false,
  updateInfo: null,
  appVersion: '',
  minimizeWindow: () => {},
  maximizeWindow: () => {},
  unmaximizeWindow: () => {},
  closeWindow: () => {},
  setWindowTitle: () => {},
  installUpdate: () => {},
  checkForUpdates: () => {},
  createBackup: () => Promise.resolve(''),
  restoreBackup: () => Promise.resolve(false),
  openFile: () => Promise.resolve(null),
  saveFile: () => Promise.resolve(null),
  showMessageBox: () => Promise.resolve({ response: 0, checkboxChecked: false }),
};

const ElectronContext = createContext<ElectronContextValue>(defaultContextValue);

interface ElectronProviderProps {
  children: ReactNode;
}

export function ElectronProvider({ children }: ElectronProviderProps) {
  const { toast } = useToast();
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [appVersion, setAppVersion] = useState('');
  
  // Initialize state and setup event listeners
  useEffect(() => {
    if (!isElectronEnvironment()) return;
    
    // Get app version from Electron
    electron.invoke('app:getVersion').then((version: string) => {
      setAppVersion(version);
    });
    
    // Subscribe to window state change events
    const unsubMaximized = electron.receive('window:maximized', () => {
      setIsMaximized(true);
    });
    
    const unsubUnmaximized = electron.receive('window:unmaximized', () => {
      setIsMaximized(false);
    });
    
    // Subscribe to update events
    const unsubUpdateAvailable = electron.receive('update:available', (info: UpdateInfo) => {
      setUpdateAvailable(true);
      setUpdateInfo(info);
      
      toast({
        title: 'Update Available',
        description: `Version ${info.version} is available for download.`,
      });
    });
    
    const unsubUpdateDownloaded = electron.receive('update:downloaded', (info: UpdateInfo) => {
      setUpdateDownloaded(true);
      setUpdateInfo(info);
      
      toast({
        title: 'Update Ready to Install',
        description: 'Restart the application to install the update.',
      });
    });
    
    const unsubUpdateError = electron.receive('update:error', (error: Error) => {
      toast({
        title: 'Update Error',
        description: `Failed to check for updates: ${error.message}`,
        variant: 'destructive',
      });
    });
    
    // Check for updates on startup
    electron.send('update:check');
    
    // Cleanup function
    return () => {
      unsubMaximized();
      unsubUnmaximized();
      unsubUpdateAvailable();
      unsubUpdateDownloaded();
      unsubUpdateError();
    };
  }, [toast]);
  
  // Window control functions
  const minimizeWindow = () => {
    if (isElectronEnvironment()) {
      electron.send('window:minimize');
    }
  };
  
  const maximizeWindow = () => {
    if (isElectronEnvironment()) {
      electron.send('window:maximize');
    }
  };
  
  const unmaximizeWindow = () => {
    if (isElectronEnvironment()) {
      electron.send('window:unmaximize');
    }
  };
  
  const closeWindow = () => {
    if (isElectronEnvironment()) {
      electron.send('window:close');
    }
  };
  
  const setWindowTitle = (title: string) => {
    if (isElectronEnvironment()) {
      electron.send('window:setTitle', title);
    }
  };
  
  // Update functions
  const installUpdate = () => {
    if (isElectronEnvironment() && updateDownloaded) {
      electron.send('update:install');
    }
  };
  
  const checkForUpdates = () => {
    if (isElectronEnvironment()) {
      electron.send('update:check');
    }
  };
  
  // Backup functions
  const createBackup = async (customPath?: string): Promise<string> => {
    if (isElectronEnvironment()) {
      try {
        const path = await electron.invoke('db:createBackup', customPath);
        toast({
          title: 'Backup Created',
          description: `Backup saved to: ${path}`,
        });
        return path;
      } catch (error) {
        toast({
          title: 'Backup Failed',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    }
    return '';
  };
  
  const restoreBackup = async (backupPath: string): Promise<boolean> => {
    if (isElectronEnvironment()) {
      try {
        await electron.invoke('db:restoreBackup', backupPath);
        toast({
          title: 'Backup Restored',
          description: 'Database has been restored successfully.',
        });
        return true;
      } catch (error) {
        toast({
          title: 'Restore Failed',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    }
    return false;
  };
  
  // File dialog functions
  const openFile = async (filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null> => {
    if (isElectronEnvironment()) {
      try {
        return await electron.invoke('dialog:openFile', { filters });
      } catch (error) {
        console.error('Failed to open file dialog:', error);
      }
    }
    return null;
  };
  
  const saveFile = async (defaultPath?: string, filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null> => {
    if (isElectronEnvironment()) {
      try {
        return await electron.invoke('dialog:saveFile', { defaultPath, filters });
      } catch (error) {
        console.error('Failed to open save dialog:', error);
      }
    }
    return null;
  };
  
  const showMessageBox = async (options: any): Promise<{ response: number; checkboxChecked: boolean }> => {
    if (isElectronEnvironment()) {
      try {
        return await electron.invoke('dialog:showMessageBox', options);
      } catch (error) {
        console.error('Failed to show message box:', error);
      }
    }
    return { response: 0, checkboxChecked: false };
  };
  
  const value: ElectronContextValue = {
    isElectron: isElectronEnvironment(),
    isMaximized,
    updateAvailable,
    updateDownloaded,
    updateInfo,
    appVersion,
    minimizeWindow,
    maximizeWindow,
    unmaximizeWindow,
    closeWindow,
    setWindowTitle,
    installUpdate,
    checkForUpdates,
    createBackup,
    restoreBackup,
    openFile,
    saveFile,
    showMessageBox,
  };
  
  return (
    <ElectronContext.Provider value={value}>
      {children}
    </ElectronContext.Provider>
  );
}

export function useElectron() {
  const context = useContext(ElectronContext);
  if (context === undefined) {
    throw new Error('useElectron must be used within an ElectronProvider');
  }
  return context;
}