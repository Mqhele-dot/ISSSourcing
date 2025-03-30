/**
 * Bridge between Electron (main process) and React (renderer process)
 * 
 * This module provides a safe way to access Electron functionality
 * from the React application.
 */

interface SystemInfo {
  platform: string;
  appVersion: string;
  isMaximized: boolean;
  isDevMode: boolean;
}

interface ElectronAPI {
  send: (channel: string, ...args: any[]) => void;
  receive: (channel: string, func: (...args: any[]) => void) => () => void;
  invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;
  getSystemInfo: () => Promise<SystemInfo>;
}

// Extend Window interface
declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

/**
 * Check if the application is running in an Electron environment
 */
export function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && !!window.electron;
}

/**
 * Get the electron API, safely
 * This will throw an error if called outside of Electron
 */
export function getElectronAPI(): ElectronAPI {
  if (!isElectronEnvironment()) {
    throw new Error("Electron API is not available in this environment");
  }
  
  return window.electron!;
}

/**
 * Safely access the electron API without throwing errors
 * This will be undefined in a non-Electron environment
 */
export const electron: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(target, prop: keyof ElectronAPI) {
    if (!isElectronEnvironment()) {
      // Return a no-op function for methods
      if (typeof target[prop] === 'function') {
        if (prop === 'invoke' || prop === 'getSystemInfo') {
          return () => Promise.reject(new Error("Electron API is not available"));
        }
        
        if (prop === 'receive') {
          return () => () => {}; // Return an unsubscribe function that does nothing
        }
        
        return () => {}; // Default no-op function
      }
      
      return undefined;
    }
    
    return window.electron![prop];
  }
});

/**
 * Setup the Electron app environment
 * - Adds appropriate classes to the HTML element
 * - Configures electron-specific behaviors
 */
export function setupElectronApp(): void {
  if (!isElectronEnvironment()) {
    return;
  }
  
  // Add platform specific class to HTML element
  electron.invoke('system:getInfo').then((info: SystemInfo) => {
    document.documentElement.classList.add(`platform-${info.platform}`);
    
    if (info.isDevMode) {
      document.documentElement.classList.add('dev-mode');
    }
  });
  
  // Prevent default behavior for drag and drop
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());
  
  // Add special class when window gets focus
  electron.receive('window:focus', () => {
    document.documentElement.classList.add('window-focused');
  });
  
  electron.receive('window:blur', () => {
    document.documentElement.classList.remove('window-focused');
  });
}