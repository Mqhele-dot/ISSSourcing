/**
 * Utility functions for interacting with Electron from the renderer process.
 * This provides type-safe wrappers around the electron IPC API.
 */

// Check if we're running in Electron environment
export function isElectronEnvironment(): boolean {
  // @ts-ignore - window.electron is injected by the Electron preload script
  return typeof window !== 'undefined' && window.electron !== undefined;
}

// Alias for isElectronEnvironment for backward compatibility
export const isElectron = isElectronEnvironment;

// App control functions
export const appControls = {
  /**
   * Minimize the application window
   */
  minimize: (): void => {
    if (!isElectronEnvironment()) return;
    // @ts-ignore - window.electron is injected by the Electron preload script
    window.electron.send('window-minimize');
  },

  /**
   * Maximize/restore the application window
   */
  maximize: (): void => {
    if (!isElectronEnvironment()) return;
    // @ts-ignore - window.electron is injected by the Electron preload script
    window.electron.send('window-maximize');
  },

  /**
   * Close the application window
   */
  close: (): void => {
    if (!isElectronEnvironment()) return;
    // @ts-ignore - window.electron is injected by the Electron preload script
    window.electron.send('window-close');
  },

  /**
   * Open the application settings
   */
  openSettings: (): void => {
    if (!isElectronEnvironment()) return;
    // @ts-ignore - window.electron is injected by the Electron preload script
    window.electron.send('open-settings');
  },

  /**
   * Check for application updates
   */
  checkForUpdates: async (): Promise<{ hasUpdate: boolean; version?: string }> => {
    if (!isElectronEnvironment()) {
      return { hasUpdate: false };
    }
    
    try {
      // @ts-ignore - window.electron is injected by the Electron preload script
      return await window.electron.invoke('check-for-updates');
    } catch (error) {
      console.error('Failed to check for updates:', error);
      return { hasUpdate: false };
    }
  }
};

// Interface for database information returned by the main process
export interface DatabaseInfo {
  status: 'healthy' | 'degraded' | 'error' | 'unknown';
  size: string;
  location: string;
  lastBackup: string | null;
  dataCount: {
    inventory: number;
    movements: number;
    suppliers: number;
    users: number;
  };
}

// Interface for backup result
export interface BackupResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * Bridge class for interacting with Electron-specific functionality
 */
export class ElectronBridge {
  /**
   * Check if the app is connected to the internet
   */
  async checkNetworkStatus(): Promise<boolean> {
    if (!isElectronEnvironment()) {
      return navigator.onLine;
    }

    try {
      // @ts-ignore - window.electron is injected by the Electron preload script
      return await window.electron.invoke('check-network-status');
    } catch (error) {
      console.error('Failed to check network status:', error);
      return navigator.onLine; // Fallback to browser's online status
    }
  }

  /**
   * Get information about the local database
   */
  async getDatabaseInfo(): Promise<DatabaseInfo> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      // @ts-ignore - window.electron is injected by the Electron preload script
      return await window.electron.invoke('get-database-info');
    } catch (error) {
      console.error('Failed to get database info:', error);
      throw error;
    }
  }

  /**
   * Create a backup of the local database
   */
  async createDatabaseBackup(): Promise<BackupResult> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      // @ts-ignore - window.electron is injected by the Electron preload script
      return await window.electron.invoke('create-database-backup');
    } catch (error) {
      console.error('Failed to create database backup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Restore the local database from a backup
   */
  async restoreDatabaseFromBackup(backupPath: string): Promise<{ success: boolean; error?: string }> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      // @ts-ignore - window.electron is injected by the Electron preload script
      return await window.electron.invoke('restore-database-backup', backupPath);
    } catch (error) {
      console.error('Failed to restore database from backup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Synchronize the local database with the remote server
   */
  async syncDatabase(): Promise<void> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      // @ts-ignore - window.electron is injected by the Electron preload script
      return await window.electron.invoke('sync-database');
    } catch (error) {
      console.error('Failed to sync database:', error);
      throw error;
    }
  }

  /**
   * Register a listener for an IPC event from the main process
   */
  on<T>(channel: string, callback: (data: T) => void): () => void {
    if (!isElectronEnvironment()) {
      console.warn(`Cannot register listener for ${channel} in non-Electron environment`);
      return () => {}; // No-op cleanup function
    }

    // @ts-ignore - window.electron is injected by the Electron preload script
    return window.electron.on(channel, callback);
  }
}