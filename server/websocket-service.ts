import { Server as HttpServer } from 'http';
import WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { IStorage } from './storage';

// Types of messages
enum MessageType {
  INVENTORY_UPDATE = 'inventory_update',
  STOCK_TRANSFER = 'stock_transfer',
  STOCK_ALERT = 'stock_alert',
  CONNECTION = 'connection',
  WAREHOUSE_UPDATE = 'warehouse_update',
  ERROR = 'error'
}

// Message structure
interface WebSocketMessage {
  type: MessageType;
  payload: any;
}

// Client connection storage
interface ClientConnection {
  id: string;
  socket: WebSocket;
  warehouses: number[];
  userId?: number;
}

// Global instance
let wss: WebSocket.Server | null = null;
let storage: IStorage | null = null;
const clients: Map<string, ClientConnection> = new Map();

/**
 * Initialize the WebSocket server for real-time inventory synchronization
 */
export function initializeWebSocketService(server: HttpServer, storageInstance: IStorage): WebSocket.Server {
  // If already initialized, return the existing instance
  if (wss) {
    return wss;
  }

  // Store the storage instance
  storage = storageInstance;

  // Create WebSocket server
  wss = new WebSocketServer({ 
    server,
    path: '/ws-inventory'
  });

  console.log('WebSocket server initialized for inventory sync');

  // Handle new client connections
  wss.on('connection', (ws: WebSocket) => {
    const clientId = uuidv4();
    
    // Store client connection
    clients.set(clientId, {
      id: clientId,
      socket: ws,
      warehouses: [] // No warehouse filter by default (receives all updates)
    });

    console.log(`WebSocket client connected: ${clientId}`);

    // Send connection confirmation with client ID
    sendMessageToClient(ws, {
      type: MessageType.CONNECTION,
      payload: { 
        id: clientId,
        message: 'Connected to inventory sync' 
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

    // Handle client disconnection
    ws.addEventListener('close', () => {
      clients.delete(clientId);
      console.log(`WebSocket client disconnected: ${clientId}`);
    });

    // Handle errors
    ws.addEventListener('error', (event) => {
      console.error(`WebSocket error for client ${clientId}:`, event);
      clients.delete(clientId);
    });
  });

  // Return the WebSocket server instance
  return wss;
}

/**
 * Send a message to a specific client
 */
function sendMessageToClient(ws: WebSocket, message: WebSocketMessage): boolean {
  if (ws.readyState === 1) { // WebSocket.OPEN is 1
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }
  return false;
}

/**
 * Send a message to all connected clients or clients subscribed to a specific warehouse
 */
function broadcastMessage(message: WebSocketMessage, warehouseId?: number): void {
  clients.forEach((client) => {
    // If warehouseId is specified, only send to clients subscribed to that warehouse
    // If client has no warehouses specified, they receive all messages
    if (
      warehouseId === undefined || 
      client.warehouses.length === 0 || 
      client.warehouses.includes(warehouseId)
    ) {
      sendMessageToClient(client.socket, message);
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
    }, warehouseId);

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

    broadcastMessage(transferMessage, sourceWarehouseId);
    
    // If someone is only subscribed to the destination warehouse, make sure they get the update too
    if (sourceWarehouseId !== destinationWarehouseId) {
      broadcastMessage(transferMessage, destinationWarehouseId);
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
      // Send a stock alert to all clients subscribed to this warehouse
      broadcastMessage({
        type: MessageType.STOCK_ALERT,
        payload: {
          item,
          warehouse,
          currentLevel: warehouseInventory.quantity,
          threshold,
          timestamp: new Date().toISOString()
        }
      }, warehouseId);

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
    }, warehouseId);

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