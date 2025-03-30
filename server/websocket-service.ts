import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { storage } from './storage';
import { stockMovementTypeEnum, InsertStockMovement, InsertActivityLog } from '@shared/schema';

// Define the message types for WebSocket communications
export interface WebSocketMessage {
  type: 'inventory_update' | 'stock_transfer' | 'stock_alert' | 'connection' | 'warehouse_update' | 'error';
  payload: any;
}

// Connected clients with their metadata
interface ConnectedClient {
  ws: WebSocket;
  id: string;
  warehouses: number[]; // List of warehouse IDs this client is interested in
}

export class InventoryWebSocketService {
  private wss: WebSocketServer;
  private clients: ConnectedClient[] = [];

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws-inventory' // Use a specific path to avoid conflicts with Vite's WebSocket
    });
    this.setupWebSocketServer();
    console.log('WebSocket server initialized on path /ws-inventory');
  }

  private setupWebSocketServer() {
    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = this.generateClientId();
      console.log(`New WebSocket client connected: ${clientId}`);

      // Add the client to our list with default of no warehouses (will be updated later)
      this.clients.push({
        ws,
        id: clientId,
        warehouses: []
      });

      // Send a welcome message with the client ID
      this.sendToClient(ws, {
        type: 'connection',
        payload: {
          id: clientId,
          message: 'Connected to Inventory Sync WebSocket Server',
          timestamp: new Date().toISOString()
        }
      });

      // Handle incoming messages
      ws.on('message', (message: string) => {
        try {
          const parsedMessage: WebSocketMessage = JSON.parse(message);
          this.handleMessage(parsedMessage, clientId, ws);
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
          this.sendToClient(ws, {
            type: 'error',
            payload: { message: 'Invalid message format' }
          } as WebSocketMessage);
        }
      });

      // Handle client disconnection
      ws.on('close', () => {
        console.log(`WebSocket client disconnected: ${clientId}`);
        this.clients = this.clients.filter(client => client.id !== clientId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
      });
    });
  }

  // Handle incoming messages from clients
  private handleMessage(message: WebSocketMessage, clientId: string, ws: WebSocket) {
    console.log(`Received message from client ${clientId}:`, message.type);

    switch (message.type) {
      case 'warehouse_update':
        // Client is informing us which warehouses they're interested in
        this.updateClientWarehouses(clientId, message.payload.warehouses);
        break;

      case 'inventory_update':
        // Client is submitting inventory updates
        this.processInventoryUpdate(message.payload);
        break;

      case 'stock_transfer':
        // Client is initiating a stock transfer
        this.processStockTransfer(message.payload);
        break;

      default:
        this.sendToClient(ws, {
          type: 'error',
          payload: { message: `Unsupported message type: ${message.type}` }
        } as WebSocketMessage);
    }
  }

  // Update which warehouses a client is interested in
  private updateClientWarehouses(clientId: string, warehouses: number[]) {
    const clientIndex = this.clients.findIndex(client => client.id === clientId);
    if (clientIndex >= 0) {
      this.clients[clientIndex].warehouses = warehouses;
      console.log(`Updated client ${clientId} warehouses:`, warehouses);
    }
  }

  // Handle inventory updates
  private async processInventoryUpdate(payload: any) {
    try {
      const { itemId, quantity, warehouseId, reason, type } = payload;

      // Create a stock movement record
      await storage.createStockMovement({
        itemId,
        quantity,
        warehouseId,
        type: type || "ADJUSTMENT",
        notes: reason || 'Inventory sync update',
        timestamp: new Date() // Use timestamp instead of createdAt
      });

      // Broadcast the update to relevant clients
      this.broadcastInventoryUpdate(itemId, warehouseId);

      // Create activity log
      await storage.createActivityLog({
        action: 'INVENTORY_UPDATE',
        userId: 1, // Using default system user ID
        description: `Item #${itemId} quantity updated by ${quantity} in warehouse #${warehouseId}`
      });

    } catch (error) {
      console.error('Error processing inventory update:', error);
    }
  }

  // Handle stock transfers between warehouses
  private async processStockTransfer(payload: any) {
    try {
      const { itemId, quantity, sourceWarehouseId, destinationWarehouseId, reason } = payload;

      // First, reduce stock in the source warehouse
      await storage.createStockMovement({
        itemId,
        quantity: -quantity,
        warehouseId: sourceWarehouseId,
        type: "TRANSFER",
        notes: reason || `Transfer to warehouse #${destinationWarehouseId}`,
        timestamp: new Date(),
        destinationWarehouseId: destinationWarehouseId, // Specify destination
        sourceWarehouseId: sourceWarehouseId // Ensure source is recorded
      });

      // No need for a second movement as the createStockMovement will handle both warehouses
      // when type is TRANSFER and destinationWarehouseId is set

      // Broadcast updates for both warehouses
      this.broadcastInventoryUpdate(itemId, sourceWarehouseId);
      this.broadcastInventoryUpdate(itemId, destinationWarehouseId);

      // Create activity log
      await storage.createActivityLog({
        action: 'STOCK_TRANSFER',
        userId: 1, // Using default system user ID
        description: `Item #${itemId} quantity ${quantity} transferred from warehouse #${sourceWarehouseId} to warehouse #${destinationWarehouseId}`
      });

    } catch (error) {
      console.error('Error processing stock transfer:', error);
    }
  }

  // Send inventory alerts based on configurable thresholds
  public async checkLowStockAlerts() {
    try {
      const lowStockItems = await storage.getLowStockItems();
      
      for (const item of lowStockItems) {
        // Get all warehouse inventories for this item
        const warehouseInventory = await storage.getItemWarehouseInventory(item.id);
        
        for (const warehouse of warehouseInventory) {
          // If warehouse quantity is below or equal to the low stock threshold
          if (warehouse.quantity <= (item.lowStockThreshold || 10)) {
            // Calculate a suggested reorder quantity (default to 10 units or twice the low stock threshold)
            const suggestedReorderQuantity = item.minOrderQuantity || (item.lowStockThreshold ? item.lowStockThreshold * 2 : 10);
            
            // Send alerts to all clients watching this warehouse
            this.broadcastToWarehouse(warehouse.warehouseId, {
              type: 'stock_alert',
              payload: {
                alertType: 'LOW_STOCK',
                item,
                warehouse,
                currentLevel: warehouse.quantity,
                reorderThreshold: item.lowStockThreshold,
                suggestedReorderQuantity: suggestedReorderQuantity,
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('Error checking for low stock alerts:', error);
    }
  }

  // Generate unique client ID
  private generateClientId(): string {
    return `client_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Send message to a specific client
  private sendToClient(ws: WebSocket, message: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // Broadcast to all clients interested in a specific warehouse
  private broadcastToWarehouse(warehouseId: number, message: WebSocketMessage) {
    const interestedClients = this.clients.filter(client => 
      client.warehouses.includes(warehouseId) || 
      client.warehouses.length === 0 // Clients listening to all warehouses
    );

    for (const client of interestedClients) {
      this.sendToClient(client.ws, message);
    }
  }

  // Broadcast inventory updates for a specific item and warehouse
  public async broadcastInventoryUpdate(itemId: number, warehouseId: number) {
    try {
      // Get the current inventory level for this item in this warehouse
      const warehouseInventory = await storage.getWarehouseInventoryItem(warehouseId, itemId);
      const item = await storage.getInventoryItem(itemId);
      
      if (!warehouseInventory || !item) {
        console.error(`Cannot broadcast update: item #${itemId} or warehouse #${warehouseId} not found`);
        return;
      }

      // Get the warehouse details
      const warehouse = await storage.getWarehouse(warehouseId);
      
      // Broadcast to all clients interested in this warehouse
      this.broadcastToWarehouse(warehouseId, {
        type: 'inventory_update',
        payload: {
          item,
          warehouseId,
          warehouseName: warehouse?.name || `Warehouse #${warehouseId}`,
          currentQuantity: warehouseInventory.quantity,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error(`Error broadcasting inventory update for item #${itemId} in warehouse #${warehouseId}:`, error);
    }
  }
}

// Singleton instance
let instance: InventoryWebSocketService | null = null;

// Function to initialize the service
export function initializeWebSocketService(server: HttpServer): InventoryWebSocketService {
  if (!instance) {
    instance = new InventoryWebSocketService(server);
  }
  return instance;
}

// Function to get the existing instance
export function getWebSocketService(): InventoryWebSocketService | null {
  return instance;
}