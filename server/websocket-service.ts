import { Server as HttpServer } from 'http';
import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { IStorage } from './storage';

// Types of messages
enum MessageType {
  INVENTORY_UPDATE = 'inventory_update',
  STOCK_TRANSFER = 'stock_transfer',
  STOCK_ALERT = 'stock_alert',
  CONNECTION = 'connection',
  WAREHOUSE_UPDATE = 'warehouse_update',
  ITEM_SUBSCRIBE = 'item_subscribe',     // Subscribe to specific items
  ITEM_UNSUBSCRIBE = 'item_unsubscribe', // Unsubscribe from specific items
  CAPABILITIES = 'capabilities',         // Client capabilities (compression support, etc.)
  ERROR = 'error'
}

// Message structure
interface WebSocketMessage {
  type: MessageType;
  payload: any;
  compressed?: boolean; // Flag to indicate if the payload is compressed
  sequenceNumber?: number; // Sequence number for ordering
}

// Client connection storage
interface ClientConnection {
  id: string;
  socket: WebSocket;
  warehouses: number[];      // Warehouses this client is subscribed to
  items: number[];           // Specific items this client is subscribed to
  lastSequenceNumber: number; // Last sequence number sent to this client
  supportsCompression: boolean; // Whether client supports compression
  userId?: number;
}

// Global instance
let wss: WebSocketServer | null = null;
let storage: IStorage | null = null;
const clients: Map<string, ClientConnection> = new Map();

/**
 * Check all inventory items for low stock and send alerts
 */
export function checkLowStockAlerts(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (!storage) {
      console.error('Storage not initialized for WebSocket service');
      return reject('Storage not initialized');
    }

    try {
      console.log('Running scheduled low stock check...');
      
      // Get all low stock items
      const lowStockItems = await storage.getLowStockItems();
      
      if (lowStockItems.length === 0) {
        console.log('No low stock items found');
        return resolve();
      }
      
      console.log(`Found ${lowStockItems.length} items with low stock`);
      
      // Send alerts for each item
      for (const item of lowStockItems) {
        // Broadcast an alert to all clients
        broadcastMessage({
          type: MessageType.STOCK_ALERT,
          payload: {
            item,
            alertType: 'low_stock',
            currentQuantity: item.quantity,
            threshold: item.lowStockThreshold,
            timestamp: new Date().toISOString()
          }
        }, undefined, item.id);
        
        // Log the alert
        await storage.createActivityLog({
          action: 'LOW_STOCK_ALERT',
          userId: null,
          description: `Low stock alert for ${item.name} (${item.sku}): ${item.quantity} units remaining (threshold: ${item.lowStockThreshold})`,
          itemId: item.id,
          referenceType: 'inventory_item'
        });
      }
      
      resolve();
    } catch (error) {
      console.error('Error checking for low stock items:', error);
      reject(error);
    }
  });
}

/**
 * Initialize the WebSocket server for real-time inventory synchronization
 */
export function initializeWebSocketService(server: HttpServer, storageInstance: IStorage | null = null): WebSocketServer {
  // If already initialized, return the existing instance
  if (wss) {
    return wss;
  }

  // Store the storage instance
  storage = storageInstance;

  // Create WebSocket server with more robust configuration
  wss = new WebSocketServer({ 
    server,
    path: '/ws',
    // Increase timeouts and add more robust handling
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

  console.log('WebSocket server initialized for inventory sync');

  // Set up server-wide error handling
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });

  wss.on('close', () => {
    console.log('WebSocket server closed');
  });

  wss.on('headers', (headers, request) => {
    console.log('WebSocket connection headers sent:', headers.join(', '));
    console.log('WebSocket connection request URL:', request.url);
  });

  // Handle new client connections
  wss.on('connection', (ws: WebSocket, request) => {
    const clientId = uuidv4();
    const clientIp = request.socket.remoteAddress;
    const clientUrl = request.url;
    
    console.log(`WebSocket client connecting: ${clientId} from ${clientIp}, URL: ${clientUrl}`);
    
    // Store client connection
    clients.set(clientId, {
      id: clientId,
      socket: ws,
      warehouses: [], // No warehouse filter by default (receives all updates)
      items: [],      // No item filter by default
      lastSequenceNumber: 0,
      supportsCompression: false // Default to no compression until negotiated
    });

    // Setup ping/pong for connection health checking
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          // Send a ping message to keep the connection alive
          ws.ping(() => {});
        } catch (error) {
          console.error(`Error sending ping to client ${clientId}:`, error);
          clearInterval(pingInterval);
        }
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // 30 seconds
    
    console.log(`WebSocket client connected: ${clientId}`);

    // Send connection confirmation with client ID
    sendMessageToClient(ws, {
      type: MessageType.CONNECTION,
      payload: { 
        id: clientId,
        message: 'Connected to inventory sync',
        serverTime: new Date().toISOString(),
        supportedFeatures: ['compression', 'item_subscriptions', 'warehouse_subscriptions']
      }
    });

    // Handle messages from client
    ws.addEventListener('message', (event) => {
      try {
        const parsedMessage = JSON.parse(event.data.toString()) as WebSocketMessage;
        handleClientMessage(clientId, parsedMessage);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        sendMessageToClient(ws, {
          type: MessageType.ERROR,
          payload: { message: 'Invalid message format' }
        });
      }
    });

    // Listen for pong responses to confirm connection is alive
    ws.addEventListener('pong', () => {
      // Connection is alive, can log if needed for debugging
      // console.log(`Received pong from client ${clientId}`);
    });

    // Handle client disconnection
    ws.addEventListener('close', (event) => {
      clearInterval(pingInterval);
      clients.delete(clientId);
      console.log(`WebSocket client disconnected: ${clientId}, code: ${event.code}, reason: ${event.reason || 'No reason provided'}`);
    });

    // Handle errors
    ws.addEventListener('error', (event) => {
      console.error(`WebSocket error for client ${clientId}:`, event);
      // Don't delete the client here - let the close event handle it
      // as error is often followed by close
    });
  });

  // Return the WebSocket server instance
  return wss;
}

/**
 * Compress data using gzip
 */
function compressData(data: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Send a message to a specific client with support for compression
 */
async function sendMessageToClient(ws: WebSocket, message: WebSocketMessage, client?: ClientConnection): Promise<boolean> {
  if (ws.readyState === 1) { // WebSocket.OPEN is 1
    try {
      // Add sequence number if we have a client connection
      if (client) {
        client.lastSequenceNumber++;
        message.sequenceNumber = client.lastSequenceNumber;
      }
      
      // Determine if we should compress this message
      // Only compress if client supports it and message payload is large enough to benefit
      const shouldCompress = client?.supportsCompression && 
                          JSON.stringify(message.payload).length > 1024; // Only compress payloads > 1KB
      
      let dataToSend: string | Buffer;
      
      if (shouldCompress) {
        // Compress payload
        const messageString = JSON.stringify(message.payload);
        const compressedData = await compressData(messageString);
        
        // Replace payload with compressed data (as base64 string)
        const compressedMessage: WebSocketMessage = {
          type: message.type,
          sequenceNumber: message.sequenceNumber,
          compressed: true,
          payload: compressedData.toString('base64')
        };
        
        dataToSend = JSON.stringify(compressedMessage);
      } else {
        // Send as normal JSON
        dataToSend = JSON.stringify(message);
      }
      
      ws.send(dataToSend);
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }
  return false;
}

/**
 * Send a message to all connected clients or clients subscribed to a specific warehouse or item
 */
function broadcastMessage(message: WebSocketMessage, warehouseId?: number, itemId?: number): void {
  clients.forEach((client) => {
    // Check warehouse filtering
    const warehouseMatch = 
      warehouseId === undefined || 
      client.warehouses.length === 0 || 
      client.warehouses.includes(warehouseId);
    
    // Check item filtering
    const itemMatch = 
      itemId === undefined || 
      client.items.length === 0 || 
      client.items.includes(itemId);
    
    // Send message if client is subscribed to both the warehouse and the item (or has no filters)
    if (warehouseMatch && itemMatch) {
      sendMessageToClient(client.socket, message, client);
    }
  });
}

/**
 * Handle a message from a client
 */
function handleClientMessage(clientId: string, message: WebSocketMessage): void {
  const client = clients.get(clientId);
  if (!client) {
    console.error(`Received message from unknown client: ${clientId}`);
    return;
  }

  switch (message.type) {
    case MessageType.WAREHOUSE_UPDATE:
      // Update client's warehouse subscriptions
      if (Array.isArray(message.payload.warehouses)) {
        client.warehouses = message.payload.warehouses;
        console.log(`Client ${clientId} updated warehouse subscriptions:`, client.warehouses);
      }
      break;

    case MessageType.ITEM_SUBSCRIBE:
      // Subscribe to specific items
      if (Array.isArray(message.payload.items)) {
        // Create a temporary array and filter out duplicates
        const combinedItems = [...client.items];
        message.payload.items.forEach((itemId: number) => {
          if (!combinedItems.includes(itemId)) {
            combinedItems.push(itemId);
          }
        });
        client.items = combinedItems;
        console.log(`Client ${clientId} subscribed to items:`, message.payload.items);
      }
      break;
      
    case MessageType.ITEM_UNSUBSCRIBE:
      // Unsubscribe from specific items
      if (Array.isArray(message.payload.items)) {
        client.items = client.items.filter(itemId => !message.payload.items.includes(itemId));
        console.log(`Client ${clientId} unsubscribed from items:`, message.payload.items);
      }
      break;
      
    case MessageType.CAPABILITIES:
      // Update client capabilities
      if (typeof message.payload.supportsCompression === 'boolean') {
        client.supportsCompression = message.payload.supportsCompression;
        console.log(`Client ${clientId} updated compression support:`, client.supportsCompression);
      }
      
      // Send acknowledgment
      sendMessageToClient(client.socket, {
        type: MessageType.CAPABILITIES,
        payload: {
          serverSupportsCompression: true,
          compressionFormats: ['gzip'],
          serverProtocolVersion: '1.0'
        }
      });
      break;

    case MessageType.INVENTORY_UPDATE:
      // Process inventory update from client
      handleInventoryUpdate(message.payload, client);
      break;

    case MessageType.STOCK_TRANSFER:
      // Process stock transfer from client
      handleStockTransfer(message.payload, client);
      break;

    default:
      console.warn(`Unknown message type received from client ${clientId}:`, message.type);
      sendMessageToClient(client.socket, {
        type: MessageType.ERROR,
        payload: { message: `Unknown message type: ${message.type}` }
      });
  }
}

/**
 * Handle an inventory update message from a client
 */
async function handleInventoryUpdate(payload: any, client: ClientConnection): Promise<void> {
  if (!storage) {
    console.error('Storage not initialized for WebSocket service');
    return;
  }

  try {
    const { itemId, quantity, warehouseId, userId, reason, type } = payload;
    
    // Validate required fields
    if (!itemId || quantity === undefined || !warehouseId) {
      sendMessageToClient(client.socket, {
        type: MessageType.ERROR,
        payload: { message: 'Missing required fields for inventory update' }
      });
      return;
    }

    // Get current warehouse inventory
    const warehouseInventory = await storage.getWarehouseInventoryItem(warehouseId, itemId);
    if (!warehouseInventory) {
      // Create it if it doesn't exist
      await storage.createWarehouseInventory({
        itemId,
        warehouseId,
        quantity: quantity
      });
    } else {
      // Update existing inventory
      await storage.updateWarehouseInventory(warehouseInventory.id, {
        quantity
      });
    }

    // Create a stock movement record
    await storage.createStockMovement({
      itemId,
      quantity,
      warehouseId,
      type: type || 'ADJUSTMENT',
      notes: reason || 'Manual update via system',
      userId: userId || null,
      sourceWarehouseId: warehouseId,
      destinationWarehouseId: null
    });

    // Log the activity
    if (userId) {
      await storage.createActivityLog({
        action: 'INVENTORY_UPDATE',
        userId,
        description: `Updated inventory for item #${itemId} in warehouse #${warehouseId}: quantity ${quantity}${reason ? ` (${reason})` : ''}`,
        itemId,
        referenceId: warehouseId,
        referenceType: 'warehouse'
      });
    }

    // Get updated item for broadcasting
    const updatedItem = await storage.getInventoryItem(itemId);
    const warehouse = await storage.getWarehouse(warehouseId);

    // Broadcast the update to all relevant clients
    broadcastMessage({
      type: MessageType.INVENTORY_UPDATE,
      payload: {
        item: updatedItem,
        warehouse,
        quantity,
        previousQuantity: warehouseInventory?.quantity || 0,
        warehouseId,
        timestamp: new Date().toISOString()
      }
    }, warehouseId, itemId);

    // Check if we need to send a low stock alert
    await checkAndSendLowStockAlert(itemId, warehouseId);

  } catch (error) {
    console.error('Error handling inventory update:', error);
    sendMessageToClient(client.socket, {
      type: MessageType.ERROR,
      payload: { message: 'Failed to process inventory update' }
    });
  }
}

/**
 * Handle a stock transfer message from a client
 */
async function handleStockTransfer(payload: any, client: ClientConnection): Promise<void> {
  if (!storage) {
    console.error('Storage not initialized for WebSocket service');
    return;
  }

  try {
    const { 
      itemId, 
      quantity, 
      sourceWarehouseId, 
      destinationWarehouseId, 
      userId, 
      reason 
    } = payload;
    
    // Validate required fields
    if (!itemId || quantity === undefined || !sourceWarehouseId || !destinationWarehouseId) {
      sendMessageToClient(client.socket, {
        type: MessageType.ERROR,
        payload: { message: 'Missing required fields for stock transfer' }
      });
      return;
    }

    // Get source warehouse inventory
    const sourceInventory = await storage.getWarehouseInventoryItem(sourceWarehouseId, itemId);
    if (!sourceInventory || sourceInventory.quantity < quantity) {
      sendMessageToClient(client.socket, {
        type: MessageType.ERROR,
        payload: { message: 'Insufficient stock in source warehouse' }
      });
      return;
    }

    // Get destination warehouse inventory
    const destinationInventory = await storage.getWarehouseInventoryItem(destinationWarehouseId, itemId);

    // Update source warehouse inventory (deduct)
    await storage.updateWarehouseInventory(sourceInventory.id, {
      quantity: sourceInventory.quantity - quantity
    });

    // Update or create destination warehouse inventory (add)
    if (destinationInventory) {
      await storage.updateWarehouseInventory(destinationInventory.id, {
        quantity: destinationInventory.quantity + quantity
      });
    } else {
      await storage.createWarehouseInventory({
        itemId,
        warehouseId: destinationWarehouseId,
        quantity: quantity
      });
    }

    // Create stock movement records
    // 1. Outgoing from source warehouse
    await storage.createStockMovement({
      itemId,
      quantity: -quantity,
      warehouseId: sourceWarehouseId,
      type: 'TRANSFER',
      sourceWarehouseId: sourceWarehouseId,
      destinationWarehouseId: destinationWarehouseId,
      notes: reason || 'Stock transfer out',
      userId: userId || null
    });

    // 2. Incoming to destination warehouse
    await storage.createStockMovement({
      itemId,
      quantity: quantity,
      warehouseId: destinationWarehouseId,
      type: 'TRANSFER',
      sourceWarehouseId: sourceWarehouseId,
      destinationWarehouseId: destinationWarehouseId,
      notes: reason || 'Stock transfer',
      userId: userId || null
    });

    // Log the activity
    if (userId) {
      await storage.createActivityLog({
        action: 'STOCK_TRANSFER',
        userId,
        description: `Transferred ${quantity} units of item #${itemId} from warehouse #${sourceWarehouseId} to warehouse #${destinationWarehouseId}${reason ? ` (${reason})` : ''}`,
        itemId,
        referenceId: sourceWarehouseId,
        referenceType: 'warehouse'
      });
    }

    // Get updated data for broadcasting
    const item = await storage.getInventoryItem(itemId);
    const sourceWarehouse = await storage.getWarehouse(sourceWarehouseId);
    const destinationWarehouse = await storage.getWarehouse(destinationWarehouseId);

    // Broadcast updates for both warehouses
    const transferMessage = {
      type: MessageType.INVENTORY_UPDATE,
      payload: {
        item,
        transfer: {
          sourceWarehouseId,
          destinationWarehouseId,
          sourceWarehouse,
          destinationWarehouse,
          quantity
        },
        timestamp: new Date().toISOString()
      }
    };

    broadcastMessage(transferMessage, sourceWarehouseId, itemId);
    
    // If someone is only subscribed to the destination warehouse, make sure they get the update too
    if (sourceWarehouseId !== destinationWarehouseId) {
      broadcastMessage(transferMessage, destinationWarehouseId, itemId);
    }

    // Check if we need to send low stock alerts
    await checkAndSendLowStockAlert(itemId, sourceWarehouseId);

  } catch (error) {
    console.error('Error handling stock transfer:', error);
    sendMessageToClient(client.socket, {
      type: MessageType.ERROR,
      payload: { message: 'Failed to process stock transfer' }
    });
  }
}

/**
 * Check if an item is below its low stock threshold and send alerts if needed
 */
async function checkAndSendLowStockAlert(itemId: number, warehouseId: number): Promise<void> {
  if (!storage) return;

  try {
    const item = await storage.getInventoryItem(itemId);
    if (!item) return;

    const warehouseInventory = await storage.getWarehouseInventoryItem(warehouseId, itemId);
    if (!warehouseInventory) return;

    const warehouse = await storage.getWarehouse(warehouseId);
    if (!warehouse) return;

    // Use item's specific threshold or the global default
    const threshold = item.lowStockThreshold !== null 
      ? item.lowStockThreshold 
      : (await storage.getAppSettings())?.lowStockDefaultThreshold || 5;

    // Check if the item is below the threshold
    if (warehouseInventory.quantity <= threshold) {
      // Send a stock alert to all clients subscribed to this warehouse or this item
      broadcastMessage({
        type: MessageType.STOCK_ALERT,
        payload: {
          item,
          warehouse,
          currentLevel: warehouseInventory.quantity,
          threshold,
          timestamp: new Date().toISOString()
        }
      }, warehouseId, itemId);

      // Log the activity
      await storage.createActivityLog({
        action: 'LOW_STOCK_ALERT',
        userId: null,
        description: `Low stock alert for ${item.name} (ID: ${item.id}) in ${warehouse.name}: ${warehouseInventory.quantity} units remaining (threshold: ${threshold})`,
        itemId: item.id,
        referenceId: warehouseId,
        referenceType: 'warehouse'
      });
    }
  } catch (error) {
    console.error('Error checking for low stock alert:', error);
  }
}

/**
 * Notify all clients about an inventory update (to be called from routes after inventory changes)
 */
export async function notifyInventoryUpdate(
  itemId: number, 
  warehouseId: number, 
  quantity: number, 
  previousQuantity: number
): Promise<void> {
  if (!storage) {
    console.error('Storage not initialized for WebSocket service');
    return;
  }

  try {
    const item = await storage.getInventoryItem(itemId);
    const warehouse = await storage.getWarehouse(warehouseId);

    if (!item || !warehouse) return;

    // Create a stock movement record to track this change
    await storage.createStockMovement({
      itemId,
      quantity: quantity - previousQuantity,
      warehouseId,
      type: 'ADJUSTMENT',
      notes: 'System inventory update',
      userId: null,
      sourceWarehouseId: warehouseId,
      destinationWarehouseId: null
    });

    broadcastMessage({
      type: MessageType.INVENTORY_UPDATE,
      payload: {
        item,
        warehouse,
        quantity,
        previousQuantity,
        warehouseId,
        timestamp: new Date().toISOString()
      }
    }, warehouseId, itemId);

    // Check if we need to send a low stock alert
    await checkAndSendLowStockAlert(itemId, warehouseId);
  } catch (error) {
    console.error('Error notifying inventory update:', error);
  }
}

/**
 * Shutdown the WebSocket server
 */
export function shutdownWebSocketService(): void {
  if (wss) {
    wss.close();
    wss = null;
    storage = null;
    clients.clear();
    console.log('WebSocket server for inventory sync has been shut down');
  }
}