/**
 * Electron Bridge
 * 
 * This module provides a bridge between the renderer process (React app)
 * and the main process (Electron) through a safe IPC layer.
 * It enables the React application to communicate with the native OS
 * functionality that Electron provides access to.
 */

interface ElectronAPI {
  send: (channel: string, ...args: any[]) => void;
  receive: (channel: string, func: (...args: any[]) => void) => () => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  isElectron: () => boolean;
  getSystemInfo: () => any;
}

/**
 * Fallback API for non-Electron environments
 * This provides no-op implementations of the electron API functions
 * so that the application can run in a browser environment without errors.
 */
const fallbackAPI: ElectronAPI = {
  send: () => {},
  receive: () => () => {},
  invoke: () => Promise.resolve(null),
  isElectron: () => false,
  getSystemInfo: () => ({
    isElectron: false,
    platform: 'web',
    arch: 'web',
    version: 'web',
  }),
};

// Add type definition for window.electron
declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

/**
 * Get the Electron API or fallback if not in Electron environment
 */
export const electron: ElectronAPI = (
  typeof window !== 'undefined' && window.electron
    ? window.electron
    : fallbackAPI
);

/**
 * Helper function to determine if the app is running in an Electron environment
 */
export function isElectronEnvironment(): boolean {
  if (typeof window !== 'undefined') {
    // Check for Electron runtime
    if (window.electron) return true;
    
    // Secondary check via userAgent (less reliable)
    const userAgent = navigator.userAgent.toLowerCase();
    return userAgent.indexOf(' electron/') > -1;
  }
  return false;
}

/**
 * Helper function to get system information from Electron
 */
export async function getSystemInfo() {
  if (isElectronEnvironment()) {
    try {
      return await electron.invoke('system:getInfo');
    } catch (error) {
      console.error('Failed to get system info:', error);
      return {
        isElectron: true,
        platform: 'unknown',
        arch: 'unknown',
        version: 'unknown',
      };
    }
  }
  
  return {
    isElectron: false,
    platform: 'web',
    arch: 'web',
    version: 'web',
  };
}