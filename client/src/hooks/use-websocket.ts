import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

export type WebSocketMessage = {
  type: 'inventory_update' | 'stock_transfer' | 'stock_alert' | 'connection' | 'warehouse_update' | 'error';
  payload: any;
};

interface UseWebSocketParams {
  warehouses?: number[]; // Warehouse IDs to subscribe to
  onInventoryUpdate?: (payload: any) => void;
  onStockAlert?: (payload: any) => void;
  onStockTransfer?: (payload: any) => void;
  onConnectionStatus?: (connected: boolean) => void;
}

export function useWebSocket({
  warehouses = [], // Default to all warehouses
  onInventoryUpdate,
  onStockAlert,
  onStockTransfer,
  onConnectionStatus,
}: UseWebSocketParams = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  
  // Reconnect logic
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectCount = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_INTERVAL = 3000; // 3 seconds
  
  // Clean up reconnect timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);
  
  // Connect to the WebSocket server
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }
    
    try {
      // Create WebSocket connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws-inventory`;
      
      socketRef.current = new WebSocket(wsUrl);
      
      // Connection opened handler
      socketRef.current.addEventListener('open', () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        onConnectionStatus?.(true);
        reconnectCount.current = 0; // Reset reconnect counter on successful connection
        clearReconnectTimeout();
        
        // Subscribe to specific warehouses (if any)
        if (warehouses.length > 0) {
          sendMessage({
            type: 'warehouse_update',
            payload: { warehouses }
          });
        }
      });
      
      // Listen for messages
      socketRef.current.addEventListener('message', (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          setLastMessage(message);
          
          // Handle different message types
          switch (message.type) {
            case 'inventory_update':
              onInventoryUpdate?.(message.payload);
              break;
            case 'stock_alert':
              onStockAlert?.(message.payload);
              // Show toast notification for low stock alerts
              if (message.payload.alertType === 'LOW_STOCK') {
                const { item, currentLevel, reorderThreshold } = message.payload;
                toast({
                  title: 'Low Stock Alert',
                  description: `${item.name} is running low (${currentLevel}/${reorderThreshold})`,
                  variant: 'destructive'
                });
              }
              break;
            case 'stock_transfer':
              onStockTransfer?.(message.payload);
              break;
            case 'error':
              console.error('WebSocket error:', message.payload);
              toast({
                title: 'Connection Error',
                description: message.payload.message || 'Unknown error occurred',
                variant: 'destructive'
              });
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });
      
      // Connection closed handler
      socketRef.current.addEventListener('close', () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        onConnectionStatus?.(false);
        
        // Attempt to reconnect if not at max attempts
        if (reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectCount.current += 1;
          
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Attempting to reconnect (${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS})...`);
            connect();
          }, RECONNECT_INTERVAL);
        } else {
          toast({
            title: 'Connection Lost',
            description: 'Could not reconnect to real-time inventory updates.',
            variant: 'destructive'
          });
        }
      });
      
      // Error handler
      socketRef.current.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        toast({
          title: 'Connection Error',
          description: 'Error connecting to real-time inventory service',
          variant: 'destructive'
        });
      });
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [onConnectionStatus, onInventoryUpdate, onStockAlert, onStockTransfer, warehouses, toast, clearReconnectTimeout]);
  
  // Send a message to the WebSocket server
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);
  
  // Disconnect from the WebSocket server
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    clearReconnectTimeout();
    setIsConnected(false);
    onConnectionStatus?.(false);
  }, [clearReconnectTimeout, onConnectionStatus]);
  
  // Connect when the component mounts
  useEffect(() => {
    connect();
    
    // Clean up the WebSocket connection when the component unmounts
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);
  
  // Update warehouse subscriptions when the warehouses prop changes
  useEffect(() => {
    if (isConnected && warehouses.length > 0) {
      sendMessage({
        type: 'warehouse_update',
        payload: { warehouses }
      });
    }
  }, [isConnected, warehouses, sendMessage]);
  
  return {
    isConnected,
    lastMessage,
    sendMessage,
    connect,
    disconnect
  };
}