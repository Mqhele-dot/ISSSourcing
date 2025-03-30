/**
 * Utility functions for interacting with Electron from the renderer process.
 * This provides type-safe wrappers around the electron IPC API.
 */

// Define the types for the Window.electron object
declare global {
  interface Window {
    electron?: {
      send: (channel: string, ...args: any[]) => void;
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: <T>(channel: string, callback: (data: T) => void) => () => void;
    };
  }
}

// Check if we're running in Electron environment
export function isElectronEnvironment(): boolean {
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

// Define types for barcode scanner
export type ScannerOptions = {
  type?: 'barcode' | 'qrcode' | 'auto';
};

export type ScanResult = {
  text: string;
  format: string;
  timestamp: number;
};

export interface BarcodeGenerateOptions {
  value: string;
  type: 'barcode' | 'qrcode';
  format?: string;
  size?: 'small' | 'medium' | 'large';
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
      return await window.electron!.invoke('check-network-status');
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
      return await window.electron!.invoke('get-database-info');
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
      return await window.electron!.invoke('create-database-backup');
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
      return await window.electron!.invoke('restore-database-backup', backupPath);
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
      return await window.electron!.invoke('sync-database');
    } catch (error) {
      console.error('Failed to sync database:', error);
      throw error;
    }
  }

  /**
   * Start the barcode scanner
   * @param options Options for the scanner
   * @returns Promise that resolves with the result of starting the scanner
   */
  async startBarcodeScanner(options?: ScannerOptions): Promise<{ success: boolean; error?: string }> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      return await window.electron!.invoke('start-barcode-scanner', options);
    } catch (error) {
      console.error('Failed to start barcode scanner:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Stop the barcode scanner
   * @returns Promise that resolves with the result of stopping the scanner
   */
  async stopBarcodeScanner(): Promise<{ success: boolean; error?: string }> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      return await window.electron!.invoke('stop-barcode-scanner');
    } catch (error) {
      console.error('Failed to stop barcode scanner:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Generate a barcode or QR code
   * @param options Options for generating the code
   * @returns Promise that resolves with the result of generating the code
   */
  async generateBarcode(options: BarcodeGenerateOptions): Promise<{ success: boolean; message?: string; error?: string }> {
    if (!isElectronEnvironment()) {
      throw new Error('Not running in Electron environment');
    }

    try {
      return await window.electron!.invoke('barcode:generate', options);
    } catch (error) {
      console.error('Failed to generate barcode:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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

    return window.electron!.on(channel, callback);
  }
}