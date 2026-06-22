/**
 * Electron Sync Service
 * 
 * Handles synchronization between the local SQLite database
 * and the remote server.
 */

const log = require('electron-log');
const { ipcMain } = require('electron');
const databaseService = require('./database-service');
const WebSocket = require('ws');

// Configuration
let syncConfig = {
  autoSync: true,
  syncInterval: 5 * 60 * 1000, // 5 minutes
  backgroundSync: true,
  syncOnStartup: true,
  syncOnNetworkChange: true,
  conflictResolution: 'server', // 'server', 'client', or 'manual'
  maxRetries: 3,
  serverUrl: '',
  compressionThreshold: 10240, // 10KB
  batchSize: 100
};

// State
let wsConnection = null;
let syncTimer = null;
let offlineQueue = [];
let isOnline = true;
let syncInProgress = false;
let syncListeners = [];
let lastSyncStatus = null;

/**
 * Initialize the sync service
 * @param {string} serverUrl Remote server URL
 * @param {Object} config Optional configuration overrides
 */
function initialize(serverUrl, config = {}) {
  syncConfig = { ...syncConfig, ...config, serverUrl };
  
  // Register IPC handlers
  registerIpcHandlers();
  
  // Set up automatic syncing if configured
  if (syncConfig.autoSync) {
    startAutoSync();
  }
  
  // Set up network change detection
  setupNetworkDetection();
  
  // Perform initial sync if configured
  if (syncConfig.syncOnStartup) {
    performSync();
  }
  
  log.info('Sync service initialized with server:', serverUrl);
}

/**
 * Register IPC handlers for sync operations
 */
function registerIpcHandlers() {
  ipcMain.handle('sync:start', async () => {
    return await performSync();
  });
  
  ipcMain.handle('sync:getStatus', () => {
    return getSyncStatus();
  });
  
  ipcMain.handle('sync:getConfig', () => {
    return syncConfig;
  });
  
  ipcMain.handle('sync:updateConfig', (_, newConfig) => {
    const oldAutoSync = syncConfig.autoSync;
    
    // Update config
    syncConfig = { ...syncConfig, ...newConfig };
    
    // Handle auto-sync state change
    if (!oldAutoSync && syncConfig.autoSync) {
      startAutoSync();
    } else if (oldAutoSync && !syncConfig.autoSync) {
      stopAutoSync();
    }
    
    return syncConfig;
  });
  
  ipcMain.handle('sync:clearQueue', () => {
    const queueSize = offlineQueue.length;
    offlineQueue = [];
    return { cleared: queueSize };
  });
  
  log.info('Sync IPC handlers registered');
}

/**
 * Setup network status detection
 */
function setupNetworkDetection() {
  // Check online status initially
  isOnline = navigator ? navigator.onLine : true;
  
  // In Electron main process, we need a different approach
  // since navigator is not available. This is a simplified version.
  setInterval(() => {
    // Use a simple ping to check connectivity
    const newOnlineStatus = checkConnectivity();
    
    if (newOnlineStatus !== isOnline) {
      const prevStatus = isOnline;
      isOnline = newOnlineStatus;
      
      log.info(`Network status changed: ${prevStatus ? 'online' : 'offline'} -> ${isOnline ? 'online' : 'offline'}`);
      
      // If we just came online and have sync on network change enabled
      if (isOnline && !prevStatus && syncConfig.syncOnNetworkChange) {
        log.info('Reconnected to network, triggering sync');
        performSync();
      }
    }
  }, 30000); // Check every 30 seconds
}

/**
 * Check connectivity to the server
 * @returns {boolean} Whether the app is online
 */
function checkConnectivity() {
  // This would be implemented to check connectivity to the server
  // For now, we'll just return true as a placeholder
  return true;
}

/**
 * Start automatic sync process
 */
function startAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
  }
  
  syncTimer = setInterval(() => {
    if (isOnline && !syncInProgress) {
      performSync();
    }
  }, syncConfig.syncInterval);
  
  log.info(`Auto sync started with interval of ${syncConfig.syncInterval / 1000} seconds`);
}

/**
 * Stop automatic sync process
 */
function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    log.info('Auto sync stopped');
  }
}

/**
 * Perform synchronization with server
 * @returns {Promise<Object>} Sync result
 */
async function performSync() {
  if (syncInProgress) {
    log.info('Sync already in progress, skipping');
    return { success: false, message: 'Sync already in progress' };
  }
  
  syncInProgress = true;
  notifySyncListeners('started');
  
  try {
    // Check if we have a websocket connection
    ensureWebSocketConnection();
    
    // First, try to send any queued offline changes
    if (offlineQueue.length > 0 && isOnline) {
      await processSyncQueue();
    }
    
    // Then perform normal sync
    const result = await databaseService.syncWithRemoteServer(
      (progress) => notifySyncListeners('progress', progress)
    );
    
    syncInProgress = false;
    lastSyncStatus = {
      timestamp: new Date().toISOString(),
      success: result.success,
      details: result
    };
    
    notifySyncListeners('completed', result);
    log.info('Sync completed', result);
    return result;
  } catch (error) {
    syncInProgress = false;
    lastSyncStatus = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message
    };
    
    notifySyncListeners('error', { error: error.message });
    log.error('Sync failed', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get current sync status
 * @returns {Object} Sync status
 */
function getSyncStatus() {
  return {
    inProgress: syncInProgress,
    isOnline,
    queueSize: offlineQueue.length,
    lastSync: lastSyncStatus,
    config: syncConfig
  };
}

/**
 * Ensure WebSocket connection is established
 */
function ensureWebSocketConnection() {
  if (!isOnline || !syncConfig.serverUrl) {
    return;
  }
  
  // If already connected, do nothing
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return;
  }
  
  // If connecting, do nothing
  if (wsConnection && wsConnection.readyState === WebSocket.CONNECTING) {
    return;
  }
  
  // Close any existing connection
  if (wsConnection) {
    try {
      wsConnection.close();
    } catch (error) {
      log.warn('Error closing WebSocket connection:', error);
    }
  }
  
  // Determine the WebSocket URL
  let wsUrl = syncConfig.serverUrl.replace(/^http/, 'ws');
  if (!wsUrl.endsWith('/')) {
    wsUrl += '/';
  }
  wsUrl += 'sync';
  
  // Create new connection
  try {
    wsConnection = new WebSocket(wsUrl);
    
    wsConnection.on('open', () => {
      log.info('WebSocket connection established');
      
      // Send device info
      wsConnection.send(JSON.stringify({
        type: 'capabilities',
        payload: {
          platform: process.platform,
          osVersion: process.getSystemVersion(),
          appVersion: process.env.npm_package_version || '1.0.0',
          isElectron: true,
          supportsCompression: true,
          deviceId: getDeviceId()
        }
      }));
    });
    
    wsConnection.on('message', (data) => {
      handleWebSocketMessage(data);
    });
    
    wsConnection.on('close', () => {
      log.info('WebSocket connection closed');
    });
    
    wsConnection.on('error', (error) => {
      log.error('WebSocket error:', error);
    });
  } catch (error) {
    log.error('Failed to establish WebSocket connection:', error);
  }
}

/**
 * Get a unique device ID
 * @returns {string} Device ID
 */
function getDeviceId() {
  // In a real app, we would generate and persist a unique device ID
  // For now, we'll just use a placeholder
  return 'electron-app-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Handle incoming WebSocket messages
 * @param {string|Buffer} data Message data
 */
function handleWebSocketMessage(data) {
  try {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'sync_request':
        // Server is requesting a sync
        performSync();
        break;
      
      case 'data_change':
        // Server is notifying about a data change
        // We would apply this change to our local database
        log.info('Received data change notification:', message.payload.entity);
        break;
      
      case 'heartbeat':
        // Respond to heartbeat
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          wsConnection.send(JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString()
          }));
        }
        break;
      
      default:
        log.warn('Unhandled WebSocket message type:', message.type);
    }
  } catch (error) {
    log.error('Error handling WebSocket message:', error);
  }
}

/**
 * Process the offline sync queue
 * @returns {Promise<boolean>} Whether processing was successful
 */
async function processSyncQueue() {
  if (offlineQueue.length === 0) {
    return true;
  }
  
  log.info(`Processing offline sync queue: ${offlineQueue.length} items`);
  
  // In a real implementation, we would actually send these changes to the server
  // For now, we'll just simulate success
  
  // Clear the queue after "processing"
  offlineQueue = [];
  
  return true;
}

/**
 * Add a sync operation to the offline queue
 * @param {string} operation Type of operation
 * @param {string} entity Entity type
 * @param {Object} data Operation data
 */
function addToOfflineQueue(operation, entity, data) {
  offlineQueue.push({
    operation,
    entity,
    data,
    timestamp: new Date().toISOString()
  });
  
  log.info(`Added ${operation} on ${entity} to offline queue. Queue size: ${offlineQueue.length}`);
}

/**
 * Register a listener for sync events
 * @param {Function} listener Event listener
 * @returns {Function} Function to remove the listener
 */
function addSyncListener(listener) {
  syncListeners.push(listener);
  
  return () => {
    syncListeners = syncListeners.filter(l => l !== listener);
  };
}

/**
 * Notify all sync listeners of an event
 * @param {string} event Event name
 * @param {any} data Event data
 */
function notifySyncListeners(event, data = null) {
  syncListeners.forEach(listener => {
    try {
      listener(event, data);
    } catch (error) {
      log.error('Error in sync listener:', error);
    }
  });
}

// Export the public API
module.exports = {
  initialize,
  performSync,
  getSyncStatus,
  addSyncListener,
  addToOfflineQueue,
};