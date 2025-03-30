import { useEffect, useState, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { queryClient } from '@/lib/queryClient';

// Define the message types that match the server
interface WebSocketMessage {
  type: 'inventory_update' | 'stock_transfer' | 'stock_alert' | 'connection' | 'warehouse_update' | 'error';
  payload: any;
}

interface InventorySyncOptions {
  // Warehouses to subscribe to (empty means all warehouses)
  warehouses?: number[];
  // Whether to automatically reconnect on disconnection
  autoReconnect?: boolean;
  // Handlers for different event types
  onInventoryUpdate?: (data: any) => void;
  onStockAlert?: (data: any) => void;
  onConnection?: (data: any) => void;
  onError?: (data: any) => void;
}

// Define the hook return type
interface InventorySyncHook {
  isConnected: boolean;
  updateInventory: (itemId: number, quantity: number, warehouseId: number, reason?: string) => void;
  transferStock: (itemId: number, quantity: number, sourceWarehouseId: number, destinationWarehouseId: number, reason?: string) => void;
  setWarehouses: (warehouseIds: number[]) => void;
  lastMessage: WebSocketMessage | null;
  connect: () => void;
  disconnect: () => void;
}

/**
 * Hook for connecting to the real-time inventory sync WebSocket
 */
export function useInventorySync(options: InventorySyncOptions = {}): InventorySyncHook {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // Get the WebSocket URL from the current window location
  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws-inventory`;
  }, []);

  // Send a message to the WebSocket server
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.error('Cannot send message, WebSocket is not connected');
      return false;
    }

    try {
      socketRef.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  }, []);

  // Set up the WebSocket connection
  const connect = useCallback(() => {
    // Don't reconnect if we're already connected
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    try {
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('WebSocket connection established');
        setIsConnected(true);

        // Send initial warehouse subscription if specified
        if (options.warehouses && options.warehouses.length > 0) {
          sendMessage({
            type: 'warehouse_update',
            payload: { warehouses: options.warehouses }
          });
        }
      };

      socket.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);

          // Handle specific message types
          switch (message.type) {
            case 'connection':
              setClientId(message.payload.id);
              if (options.onConnection) {
                options.onConnection(message.payload);
              }
              break;

            case 'inventory_update':
              // When inventory updates come in, invalidate the relevant queries
              queryClient.invalidateQueries({ queryKey: ['/api/inventory'] });
              if (message.payload.warehouseId) {
                queryClient.invalidateQueries({ queryKey: ['/api/warehouses', message.payload.warehouseId, 'inventory'] });
              }
              if (message.payload.item?.id) {
                queryClient.invalidateQueries({ queryKey: ['/api/inventory', message.payload.item.id] });
              }
              
              if (options.onInventoryUpdate) {
                options.onInventoryUpdate(message.payload);
              }
              break;

            case 'stock_alert':
              // Show a toast notification for stock alerts
              toast({
                title: 'Low Stock Alert',
                description: `${message.payload.item.name} is running low in ${message.payload.warehouse.warehouseName} (${message.payload.currentLevel} units)`,
                variant: 'destructive',
              });
              
              if (options.onStockAlert) {
                options.onStockAlert(message.payload);
              }
              break;

            case 'error':
              console.error('WebSocket error:', message.payload);
              
              if (options.onError) {
                options.onError(message.payload);
              }
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      socket.onclose = () => {
        console.log('WebSocket connection closed');
        setIsConnected(false);

        // Set up reconnection if configured
        if (options.autoReconnect !== false) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect WebSocket...');
            connect();
          }, 3000); // Reconnect after 3 seconds
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        
        if (options.onError) {
          options.onError({ message: 'WebSocket connection error' });
        }
      };
    } catch (error) {
      console.error('Error establishing WebSocket connection:', error);
      setIsConnected(false);
    }
  }, [getWebSocketUrl, options, sendMessage, toast]);

  // Clean up the WebSocket connection
  const disconnect = useCallback(() => {
    // Clear any reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close the socket if it exists
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setIsConnected(false);
  }, []);

  // Update which warehouses we're subscribed to
  const setWarehouses = useCallback((warehouseIds: number[]) => {
    if (isConnected && clientId) {
      sendMessage({
        type: 'warehouse_update',
        payload: { warehouses: warehouseIds }
      });
    }
  }, [isConnected, clientId, sendMessage]);

  // Send an inventory update message
  const updateInventory = useCallback((
    itemId: number,
    quantity: number,
    warehouseId: number,
    reason?: string
  ) => {
    if (!isConnected) {
      toast({
        title: 'Not Connected',
        description: 'Cannot update inventory: WebSocket not connected',
        variant: 'destructive',
      });
      return false;
    }

    return sendMessage({
      type: 'inventory_update',
      payload: {
        itemId,
        quantity,
        warehouseId,
        userId: user?.id,
        reason: reason || 'Manual adjustment',
        type: 'ADJUSTMENT'
      }
    });
  }, [isConnected, sendMessage, toast, user]);

  // Send a stock transfer message
  const transferStock = useCallback((
    itemId: number,
    quantity: number,
    sourceWarehouseId: number,
    destinationWarehouseId: number,
    reason?: string
  ) => {
    if (!isConnected) {
      toast({
        title: 'Not Connected',
        description: 'Cannot transfer stock: WebSocket not connected',
        variant: 'destructive',
      });
      return false;
    }

    return sendMessage({
      type: 'stock_transfer',
      payload: {
        itemId,
        quantity,
        sourceWarehouseId,
        destinationWarehouseId,
        userId: user?.id,
        reason: reason || 'Manual stock transfer'
      }
    });
  }, [isConnected, sendMessage, toast, user]);

  // Connect when the component mounts
  useEffect(() => {
    connect();

    // Clean up on unmount
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Update warehouses when the warehouses option changes
  useEffect(() => {
    if (isConnected && options.warehouses) {
      setWarehouses(options.warehouses);
    }
  }, [isConnected, options.warehouses, setWarehouses]);

  return {
    isConnected,
    updateInventory,
    transferStock,
    setWarehouses,
    lastMessage,
    connect,
    disconnect
  };
}