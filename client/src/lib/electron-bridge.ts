/**
 * Electron Bridge - Helper functions for communicating with Electron
 * 
 * This module provides utility functions to safely communicate with Electron's
 * main process from the renderer process. It handles environment detection and
 * provides type-safe function calls.
 */

// Check if we're running in Electron
export function isElectronEnvironment(): boolean {
  return window.electron !== undefined;
}

// Alias for backward compatibility
export const isElectron = isElectronEnvironment;

// Electron Bridge class for type safety and organization
export class ElectronBridge {
  constructor() {
    if (!isElectronEnvironment()) {
      console.warn('Creating ElectronBridge in non-Electron environment');
    }
  }

  invoke<T = any>(channel: string, ...args: any[]): Promise<T> {
    if (!isElectronEnvironment()) {
      return Promise.reject(new Error('Not running in Electron environment'));
    }
    return window.electron!.invoke(channel, ...args);
  }

  send(channel: string, ...args: any[]): void {
    if (!isElectronEnvironment()) {
      console.warn('Not running in Electron environment, message not sent');
      return;
    }
    window.electron!.send(channel, ...args);
  }

  on<T = any>(channel: string, callback: (data: T) => void): () => void {
    if (!isElectronEnvironment()) {
      console.warn('Not running in Electron environment, listener not added');
      return () => {};
    }
    return window.electron!.on(channel, callback);
  }
}

// App control helpers
export const appControls = {
  getVersion: async (): Promise<string> => {
    if (!isElectronEnvironment()) {
      return '0.0.0';
    }
    return callElectronBridge('app', 'getVersion');
  },
  
  minimize: () => {
    if (isElectronEnvironment()) {
      sendToElectron('window:minimize');
    }
  },
  
  maximize: () => {
    if (isElectronEnvironment()) {
      sendToElectron('window:maximize');
    }
  },
  
  close: () => {
    if (isElectronEnvironment()) {
      sendToElectron('window:close');
    }
  },
  
  installUpdate: () => {
    if (isElectronEnvironment()) {
      sendToElectron('app:install-update');
    }
  },
  
  onUpdateAvailable: (callback: (updateInfo: any) => void) => {
    if (!isElectronEnvironment()) {
      return () => {};
    }
    return listenToElectron('update:available', callback);
  },
  
  onUpdateDownloaded: (callback: (updateInfo: any) => void) => {
    if (!isElectronEnvironment()) {
      return () => {};
    }
    return listenToElectron('update:downloaded', callback);
  }
};

// Types for database operations
export interface DatabaseInfo {
  size: number;
  tables: { name: string; rows: number }[];
  lastSync: string | null;
  version: string;
}

export interface BackupResult {
  success: boolean;
  path: string | null;
  error?: string;
}

// Type definition for barcode scanning
export interface ScanResult {
  text: string;
  format: string;
  timestamp: number;
}

/**
 * Call a method exposed by the Electron preload script
 * @param category The category of functionality (e.g., 'window', 'app', 'db')
 * @param method The specific method to call
 * @param args Optional arguments to pass to the method
 * @returns Promise that resolves with the result from Electron, or rejects if not in Electron
 */
export async function callElectronBridge<T = any>(
  category: string,
  method: string,
  ...args: any[]
): Promise<T> {
  if (!isElectronEnvironment()) {
    throw new Error('Not running in Electron environment');
  }

  try {
    // We already checked that window.electron is defined above
    return await window.electron!.invoke(`${category}:${method}`, ...args);
  } catch (error) {
    console.error(`Error calling Electron ${category}:${method}:`, error);
    throw error;
  }
}

/**
 * Send a message to Electron's main process without expecting a response
 * @param channel The IPC channel to send on
 * @param args Arguments to pass with the message
 */
export function sendToElectron(channel: string, ...args: any[]): void {
  if (!isElectronEnvironment()) {
    console.warn('Not running in Electron environment, message not sent');
    return;
  }

  window.electron!.send(channel, ...args);
}

/**
 * Add a listener for messages from Electron's main process
 * @param channel The IPC channel to listen on
 * @param callback Function to call when a message is received
 * @returns Function to remove the listener
 */
export function listenToElectron<T = any>(
  channel: string,
  callback: (data: T) => void
): () => void {
  if (!isElectronEnvironment()) {
    console.warn('Not running in Electron environment, listener not added');
    return () => {}; // No-op cleanup function
  }

  return window.electron!.on(channel, callback);
}

/**
 * Get system information from Electron
 * @returns System information object or null if not in Electron
 */
export async function getSystemInfo(): Promise<any | null> {
  if (!isElectronEnvironment()) {
    return null;
  }

  try {
    return await window.electron!.getSystemInfo();
  } catch (error) {
    console.error('Error getting system info:', error);
    return null;
  }
}

// Add a type declaration for the electron object added by preload.js
declare global {
  interface Window {
    electron?: {
      send: (channel: string, ...args: any[]) => void;
      invoke: <T>(channel: string, ...args: any[]) => Promise<T>;
      on: <T>(channel: string, callback: (data: T) => void) => () => void;
      getSystemInfo: () => Promise<any>;
    };
    process?: {
      platform?: string;
      arch?: string;
      version?: string;
    };
  }
}