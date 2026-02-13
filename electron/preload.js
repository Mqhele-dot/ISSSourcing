/**
 * Preload Script for Electron
 * 
 * This script runs in the context of the renderer process before the web page loads.
 * It provides a safe way to expose specific Node.js functionality to the renderer 
 * process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

/**
 * Expose selected APIs from Electron to the renderer process.
 * These APIs are accessible via `window.electron` in the renderer.
 */
contextBridge.exposeInMainWorld('electron', {
  /**
   * Send a message to the main process via IPC
   * @param {string} channel - The channel name
   * @param {any[]} args - Arguments to pass to the main process
   */
  send: (channel, ...args) => {
    // Whitelist of channels that are allowed to be sent from the renderer
    const validSendChannels = [
      'window:minimize',
      'window:maximize',
      'window:close',
      'app:check-updates',
      'app:install-update'
    ];
    
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  
  /**
   * Set up a listener for messages from the main process
   * @param {string} channel - The channel to listen on
   * @param {Function} func - Callback function
   * @returns {Function} - Function to remove the listener
   */
  on: (channel, func) => {
    // Whitelist of channels that are allowed to be received by the renderer
    const validReceiveChannels = [
      'update-available',
      'update-downloaded',
      'menu:export-excel',
      'menu:export-csv',
      'menu:export-pdf'
    ];
    
    if (validReceiveChannels.includes(channel)) {
      // Add the event listener
      const subscription = (event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      
      // Return a function to clean up the event listener
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    
    // Return a no-op function if the channel is not valid
    return () => {};
  },
  
  /**
   * Invoke a method in the main process and get a Promise for the result
   * @param {string} channel - The channel name
   * @param {any[]} args - Arguments to pass to the main process
   * @returns {Promise<any>} - Promise that resolves with the result
   */
  invoke: (channel, ...args) => {
    // Whitelist of channels that are allowed to be invoked from the renderer
    const validInvokeChannels = [
      'window:is-maximized',
      'app:get-version',
      'app:get-data-directory',
      'document:generate-pdf',
      'document:export-excel',
      'document:export-csv',
      'dialog:open-file',
      'dialog:save-file',
      'barcode:scan',
      'database:create-backup',
      'database:restore'
    ];
    
    if (validInvokeChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    
    // Return a rejected promise if the channel is not valid
    return Promise.reject(new Error(`Unauthorized IPC invoke: ${channel}`));
  },
  
  // System information API
  system: {
    /**
     * Get information about the system
     * @returns {Object} - Object containing system information
     */
    getInfo: () => ({
      platform: process.platform,
      arch: process.arch,
      version: process.getSystemVersion(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      memory: {
        total: os.totalmem(),
        free: os.freemem()
      }
    })
  }
});