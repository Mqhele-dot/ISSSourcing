import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { IStorage } from './storage';
import * as zlib from 'zlib';
import { promisify } from 'util';

// Promisify zlib methods
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

// Types of real-time messages
export enum SyncMessageType {
  SYNC_REQUEST = 'sync_request',
  SYNC_RESPONSE = 'sync_response',
  SYNC_ERROR = 'sync_error',
  DATA_CHANGE = 'data_change',
  SYNC_COMPLETE = 'sync_complete',
  CAPABILITIES = 'capabilities',
  HEARTBEAT = 'heartbeat',
  CONNECTION_INFO = 'connection_info'
}

// Message structure for real-time sync
export interface SyncMessage {
  type: SyncMessageType;
  payload: any;
  timestamp: string;
  clientId?: string;
  compressed?: boolean;
  sequenceNumber?: number;
}

// Client connection information
interface SyncClient {
  id: string;
  socket: WebSocket;
  lastActivity: Date;
  supportsCompression: boolean;
  lastSequenceNumber: number;
  isElectron: boolean;
  syncInProgress: boolean;
  deviceInfo?: {
    platform?: string;
    osVersion?: string;
    appVersion?: string;
    networkType?: string;
  };
}

// Global WebSocket server instance
let syncWss: WebSocketServer | null = null;
let storage: IStorage | null = null;
const syncClients = new Map<string, SyncClient>();
let syncSequence = 0;

/**
 * Initialize the WebSocket server for real-time data synchronization
 */
export function initializeRealTimeSyncService(server: HttpServer, storageInstance: IStorage): WebSocketServer {
  // If already initialized, return the existing instance
  if (syncWss) {
    return syncWss;
  }

  // Store the storage instance
  storage = storageInstance;

  // Create WebSocket server
  syncWss = new WebSocketServer({
    server,
    path: '/sync',
    clientTracking: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      concurrencyLimit: 10,
      threshold: 1024 // Only compress messages larger than 1KB
    }
  });

  console.log('Real-time sync WebSocket service initialized');

  // Set up error handling
  syncWss.on('error', (error) => {
    console.error('Real-time sync WebSocket server error:', error);
  });

  // Handle new client connections
  syncWss.on('connection', (ws: WebSocket, request) => {
    const clientId = uuidv4();
    const clientIp = request.socket.remoteAddress;
    
    console.log(`Real-time sync client connecting: ${clientId} from ${clientIp}`);
    
    // Store client information
    syncClients.set(clientId, {
      id: clientId,
      socket: ws,
      lastActivity: new Date(),
      supportsCompression: false, // Default until negotiated
      lastSequenceNumber: 0,
      isElectron: false, // Default until client identifies itself
      syncInProgress: false
    });

    // Setup ping/pong for connection health monitoring
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Update last activity timestamp when sending heartbeat
          const client = syncClients.get(clientId);
          if (client) {
            client.lastActivity = new Date();
            
            // Send a heartbeat message
            sendSyncMessage(ws, {
              type: SyncMessageType.HEARTBEAT,
              payload: { timestamp: new Date().toISOString() },
              timestamp: new Date().toISOString()
            }, client);
          }
        } catch (error) {
          console.error(`Error sending heartbeat to client ${clientId}:`, error);
          clearInterval(pingInterval);
        }
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // 30 seconds

    // Send connection confirmation
    sendSyncMessage(ws, {
      type: SyncMessageType.CONNECTION_INFO,
      payload: {
        clientId,
        serverTime: new Date().toISOString(),
        features: {
          compression: true,
          partialSync: true,
          deltaUpdates: true
        }
      },
      timestamp: new Date().toISOString()
    });

    // Handle messages from client
    ws.on('message', async (data) => {
      try {
        // Update last activity timestamp
        const client = syncClients.get(clientId);
        if (client) {
          client.lastActivity = new Date();
        }

        // Parse the message
        let messageString = data.toString();
        let message: SyncMessage;

        try {
          message = JSON.parse(messageString);
        } catch (error) {
          console.error(`Invalid JSON from client ${clientId}:`, error);
          sendSyncMessage(ws, {
            type: SyncMessageType.SYNC_ERROR,
            payload: { error: 'Invalid message format' },
            timestamp: new Date().toISOString()
          });
          return;
        }

        // Process the message
        await handleSyncMessage(clientId, message);
      } catch (error) {
        console.error(`Error processing message from client ${clientId}:`, error);
        sendSyncMessage(ws, {
          type: SyncMessageType.SYNC_ERROR,
          payload: { error: 'Failed to process message' },
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle client disconnection
    ws.on('close', (code, reason) => {
      clearInterval(pingInterval);
      syncClients.delete(clientId);
      console.log(`Real-time sync client disconnected: ${clientId}, code: ${code}, reason: ${reason || 'No reason'}`);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      // The close event will handle cleanup
    });
  });

  // Start a background task to check for inactive clients and clean them up
  setInterval(cleanupInactiveClients, 5 * 60 * 1000); // Every 5 minutes

  return syncWss;
}

/**
 * Handle a sync message from a client
 */
async function handleSyncMessage(clientId: string, message: SyncMessage): Promise<void> {
  const client = syncClients.get(clientId);
  if (!client) {
    console.error(`Received message from unknown client: ${clientId}`);
    return;
  }

  switch (message.type) {
    case SyncMessageType.SYNC_REQUEST:
      await handleSyncRequest(client, message.payload);
      break;
      
    case SyncMessageType.CAPABILITIES:
      handleCapabilitiesMessage(client, message.payload);
      break;
      
    case SyncMessageType.DATA_CHANGE:
      await handleDataChangeMessage(client, message.payload);
      break;
      
    default:
      console.warn(`Unknown sync message type: ${message.type} from client ${clientId}`);
      sendSyncMessage(client.socket, {
        type: SyncMessageType.SYNC_ERROR,
        payload: { error: `Unknown message type: ${message.type}` },
        timestamp: new Date().toISOString()
      }, client);
  }
}

/**
 * Handle a client's capabilities message
 */
function handleCapabilitiesMessage(client: SyncClient, payload: any): void {
  // Update client capabilities
  if (typeof payload.supportsCompression === 'boolean') {
    client.supportsCompression = payload.supportsCompression;
  }
  
  if (typeof payload.isElectron === 'boolean') {
    client.isElectron = payload.isElectron;
  }
  
  if (payload.deviceInfo) {
    client.deviceInfo = {
      ...client.deviceInfo,
      ...payload.deviceInfo
    };
  }
  
  console.log(`Updated capabilities for client ${client.id}:`, {
    supportsCompression: client.supportsCompression,
    isElectron: client.isElectron,
    deviceInfo: client.deviceInfo
  });
  
  // Acknowledge the capabilities update
  sendSyncMessage(client.socket, {
    type: SyncMessageType.CAPABILITIES,
    payload: {
      acknowledged: true,
      serverCapabilities: {
        supportsCompression: true,
        supportsDeltaUpdates: true
      }
    },
    timestamp: new Date().toISOString()
  }, client);
}

/**
 * Handle a sync request from a client
 */
async function handleSyncRequest(client: SyncClient, payload: any): Promise<void> {
  if (!storage) {
    sendSyncMessage(client.socket, {
      type: SyncMessageType.SYNC_ERROR,
      payload: { error: 'Storage not initialized' },
      timestamp: new Date().toISOString()
    }, client);
    return;
  }
  
  try {
    client.syncInProgress = true;
    console.log(`Starting sync for client ${client.id}, requested datasets: ${payload.datasets?.join(', ') || 'all'}`);
    
    // Default to all datasets if none specified
    const datasets = payload.datasets || [
      'inventory', 
      'warehouses', 
      'suppliers', 
      'categories',
      'units'
    ];
    
    // Timestamp for consistent snapshot
    const syncTimestamp = new Date().toISOString();
    
    // Process each requested dataset
    for (const dataset of datasets) {
      let data: any[] = [];
      
      // Fetch the requested data
      switch (dataset) {
        case 'inventory':
          data = await storage.getAllInventoryItems();
          break;
        case 'warehouses':
          data = await storage.getAllWarehouses();
          break;
        case 'suppliers':
          data = await storage.getAllSuppliers();
          break;
        case 'categories':
          data = await storage.getAllCategories();
          break;
        case 'units':
          data = await storage.getAllUnits();
          break;
        default:
          console.warn(`Unknown dataset requested: ${dataset}`);
          continue;
      }
      
      // Send the data to the client
      sendSyncMessage(client.socket, {
        type: SyncMessageType.SYNC_RESPONSE,
        payload: {
          dataset,
          data,
          timestamp: syncTimestamp,
          total: data.length,
          complete: true
        },
        timestamp: syncTimestamp
      }, client);
      
      // Small delay between datasets to prevent overwhelming the client
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Sync complete
    sendSyncMessage(client.socket, {
      type: SyncMessageType.SYNC_COMPLETE,
      payload: {
        timestamp: syncTimestamp,
        datasets
      },
      timestamp: new Date().toISOString()
    }, client);
    
    console.log(`Sync completed for client ${client.id}`);
  } catch (error) {
    console.error(`Error processing sync request for client ${client.id}:`, error);
    sendSyncMessage(client.socket, {
      type: SyncMessageType.SYNC_ERROR,
      payload: {
        error: 'Failed to process sync request',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      timestamp: new Date().toISOString()
    }, client);
  } finally {
    client.syncInProgress = false;
  }
}

/**
 * Handle a data change message from a client
 */
async function handleDataChangeMessage(client: SyncClient, payload: any): Promise<void> {
  if (!storage) {
    sendSyncMessage(client.socket, {
      type: SyncMessageType.SYNC_ERROR,
      payload: { error: 'Storage not initialized' },
      timestamp: new Date().toISOString()
    }, client);
    return;
  }
  
  try {
    const { entity, action, data, id } = payload;
    
    if (!entity || !action) {
      sendSyncMessage(client.socket, {
        type: SyncMessageType.SYNC_ERROR,
        payload: { error: 'Missing required fields: entity and action' },
        timestamp: new Date().toISOString()
      }, client);
      return;
    }
    
    console.log(`Processing data change: ${action} ${entity} from client ${client.id}`);
    
    // Handle the data change based on entity and action
    let result: any;
    switch (entity) {
      case 'inventory':
        switch (action) {
          case 'create':
            result = await storage.createInventoryItem(data);
            break;
          case 'update':
            result = await storage.updateInventoryItem(id, data);
            break;
          case 'delete':
            result = await storage.deleteInventoryItem(id);
            break;
        }
        break;
        
      case 'warehouse':
        switch (action) {
          case 'create':
            result = await storage.createWarehouse(data);
            break;
          case 'update':
            result = await storage.updateWarehouse(id, data);
            break;
          case 'delete':
            result = await storage.deleteWarehouse(id);
            break;
        }
        break;
        
      // Add cases for other entities as needed
        
      default:
        sendSyncMessage(client.socket, {
          type: SyncMessageType.SYNC_ERROR,
          payload: { error: `Unsupported entity: ${entity}` },
          timestamp: new Date().toISOString()
        }, client);
        return;
    }
    
    // Broadcast the change to all other clients
    broadcastDataChange(client.id, entity, action, result);
    
    // Send acknowledgment to the originating client
    sendSyncMessage(client.socket, {
      type: SyncMessageType.DATA_CHANGE,
      payload: {
        acknowledged: true,
        entity,
        action,
        id: result?.id || id,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    }, client);
    
  } catch (error) {
    console.error(`Error processing data change from client ${client.id}:`, error);
    sendSyncMessage(client.socket, {
      type: SyncMessageType.SYNC_ERROR,
      payload: {
        error: 'Failed to process data change',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      timestamp: new Date().toISOString()
    }, client);
  }
}

/**
 * Broadcast a data change to all connected clients except the originator
 */
function broadcastDataChange(originClientId: string, entity: string, action: string, data: any): void {
  const message: SyncMessage = {
    type: SyncMessageType.DATA_CHANGE,
    payload: {
      entity,
      action,
      data,
      originClientId,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  };
  
  syncClients.forEach((client, clientId) => {
    // Don't send back to the originator
    if (clientId !== originClientId && client.socket.readyState === WebSocket.OPEN) {
      sendSyncMessage(client.socket, message, client);
    }
  });
}

/**
 * Send a sync message to a client
 */
async function sendSyncMessage(ws: WebSocket, message: SyncMessage, client?: SyncClient): Promise<boolean> {
  if (ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  
  try {
    // Add sequence number if we have a client connection
    if (client) {
      client.lastSequenceNumber++;
      message.sequenceNumber = client.lastSequenceNumber;
    }
    
    // Create a copy that includes clientId if available
    const messageToSend = {
      ...message,
      clientId: client?.id
    };
    
    // Determine if we should compress
    const shouldCompress = client?.supportsCompression && 
                         JSON.stringify(message.payload).length > 1024;
    
    let dataToSend: string | Buffer;
    
    if (shouldCompress) {
      // Compress the payload only
      const payloadStr = JSON.stringify(message.payload);
      const compressedPayload = await gzipAsync(Buffer.from(payloadStr));
      
      // Create a message with compressed payload
      const compressedMessage = {
        ...messageToSend,
        compressed: true,
        payload: compressedPayload.toString('base64')
      };
      
      dataToSend = JSON.stringify(compressedMessage);
    } else {
      dataToSend = JSON.stringify(messageToSend);
    }
    
    ws.send(dataToSend);
    return true;
  } catch (error) {
    console.error('Error sending sync message:', error);
    return false;
  }
}

/**
 * Clean up inactive clients
 */
function cleanupInactiveClients(): void {
  const now = new Date();
  const inactivityThreshold = 10 * 60 * 1000; // 10 minutes
  
  syncClients.forEach((client, clientId) => {
    const lastActivity = client.lastActivity.getTime();
    const inactiveTime = now.getTime() - lastActivity;
    
    if (inactiveTime > inactivityThreshold) {
      console.log(`Cleaning up inactive client ${clientId} (inactive for ${Math.round(inactiveTime / 1000 / 60)} minutes)`);
      
      // Close the connection if it's still open
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.close(1000, 'Inactivity timeout');
      }
      
      // Remove from clients map
      syncClients.delete(clientId);
    }
  });
  
  console.log(`Cleanup complete. Active clients: ${syncClients.size}`);
}

/**
 * Get the number of connected clients
 */
export function getConnectedClientCount(): number {
  return syncClients.size;
}

/**
 * Get information about connected clients
 */
export function getConnectedClientInfo(): any[] {
  const clientInfo: any[] = [];
  
  syncClients.forEach((client, clientId) => {
    clientInfo.push({
      id: clientId,
      lastActivity: client.lastActivity,
      isElectron: client.isElectron,
      deviceInfo: client.deviceInfo || {},
      syncInProgress: client.syncInProgress
    });
  });
  
  return clientInfo;
}

/**
 * Broadcast a message to all connected clients
 */
export function broadcastToAllClients(message: SyncMessage): number {
  let successCount = 0;
  
  syncClients.forEach((client) => {
    if (client.socket.readyState === WebSocket.OPEN) {
      const success = sendSyncMessage(client.socket, message, client);
      if (success) {
        successCount++;
      }
    }
  });
  
  return successCount;
}

/**
 * Notify all clients about a data change
 */
export function notifyDataChange(entity: string, action: string, data: any): number {
  const message: SyncMessage = {
    type: SyncMessageType.DATA_CHANGE,
    payload: {
      entity,
      action,
      data,
      originClientId: 'server',
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  };
  
  return broadcastToAllClients(message);
}