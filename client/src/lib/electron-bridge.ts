/**
 * Electron Bridge
 * 
 * This module provides a TypeScript interface for communicating with the Electron
 * main process via the IPC bridge exposed in the preload script.
 */

// Define the Electron API interface
interface ElectronAPI {
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, func: (...args: any[]) => void) => () => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  system: {
    getInfo: () => SystemInfo;
  };
}

// Define the system information interface
interface SystemInfo {
  platform: string;
  arch: string;
  version: string;
  hostname: string;
  cpus: number;
  memory: {
    total: number;
    free: number;
  };
}

// Define the update information interface
interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
}

// Get the electron API from the window object
const electron = (window as any).electron as ElectronAPI | undefined;

// Check if running in Electron
export const isElectron = !!electron;

// Window control functions
export const windowControls = {
  minimize: () => {
    electron?.send('window:minimize');
  },
  
  maximize: () => {
    electron?.send('window:maximize');
  },
  
  close: () => {
    electron?.send('window:close');
  },
  
  isMaximized: async (): Promise<boolean> => {
    if (!electron) return false;
    return await electron.invoke('window:is-maximized');
  }
};

// App control functions
export const appControls = {
  getVersion: async (): Promise<string> => {
    if (!electron) return '0.0.0';
    return await electron.invoke('app:get-version');
  },
  
  getDataDirectory: async (): Promise<string> => {
    if (!electron) return '';
    return await electron.invoke('app:get-data-directory');
  },
  
  checkForUpdates: () => {
    electron?.send('app:check-updates');
  },
  
  installUpdate: () => {
    electron?.send('app:install-update');
  },
  
  onUpdateAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
    if (!electron) return () => {};
    return electron.on('update-available', callback);
  },
  
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void): (() => void) => {
    if (!electron) return () => {};
    return electron.on('update-downloaded', callback);
  }
};

// Document generation functions
export const documentControls = {
  generatePdf: async (data: any, templateName: string, options: any = {}): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('document:generate-pdf', data, templateName, options);
  },
  
  exportToExcel: async (data: any[], options: any = {}): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('document:export-excel', data, options);
  },
  
  exportToCsv: async (data: any[], options: any = {}): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('document:export-csv', data, options);
  },
  
  onExportExcelRequest: (callback: () => void): (() => void) => {
    if (!electron) return () => {};
    return electron.on('menu:export-excel', callback);
  },
  
  onExportCsvRequest: (callback: () => void): (() => void) => {
    if (!electron) return () => {};
    return electron.on('menu:export-csv', callback);
  },
  
  onExportPdfRequest: (callback: () => void): (() => void) => {
    if (!electron) return () => {};
    return electron.on('menu:export-pdf', callback);
  }
};

// Dialog functions
export const dialogControls = {
  openFile: async (options: any = {}): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('dialog:open-file', options);
  },
  
  saveFile: async (options: any = {}): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('dialog:save-file', options);
  }
};

// Barcode scanner functions
export const barcodeControls = {
  scan: async (): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('barcode:scan');
  }
};

// Database functions
export const databaseControls = {
  createBackup: async (options: any = {}): Promise<string | null> => {
    if (!electron) return null;
    return await electron.invoke('database:create-backup', options);
  },
  
  restoreFromBackup: async (backupPath: string): Promise<boolean> => {
    if (!electron) return false;
    return await electron.invoke('database:restore', backupPath);
  }
};

// System information
export const systemInfo = {
  getInfo: (): SystemInfo | null => {
    if (!electron) return null;
    return electron.system.getInfo();
  }
};

// Export a default object with all controls
export default {
  isElectron,
  windowControls,
  appControls,
  documentControls,
  dialogControls,
  barcodeControls,
  databaseControls,
  systemInfo
};