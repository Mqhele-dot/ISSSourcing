import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { isElectronEnvironment } from '@/lib/electron-bridge';

export type WebSocketMessage = {
  type: 'inventory_update' | 'stock_transfer' | 'stock_alert' | 'connection' | 'warehouse_update' | 'error' | 'item_subscribe' | 'item_unsubscribe' | 'capabilities';
  payload: any;
  compressed?: boolean;
  sequenceNumber?: number;
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
  
  // Get the appropriate WebSocket URL for the current environment
  const getWebSocketUrl = useCallback(() => {
    if (isElectronEnvironment()) {
      console.log('Detected Electron environment, using localhost WebSocket URL');
      return 'ws://localhost:5000/ws';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      console.log(`Using standard WebSocket URL: ${url}`);
      return url;
    }
  }, []);
  
  // Connect to the WebSocket server
  const connect = useCallback(() => {
    // If already connected or attempting to connect, do nothing
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected.');
      return;
    }
    
    if (socketRef.current && socketRef.current.readyState === WebSocket.CONNECTING) {
      console.log('WebSocket connection already in progress.');
      return;
    }
    
    try {
      // Close any existing connection
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch (err) {
          console.error('Error closing existing WebSocket:', err);
        }
      }
      
      // Get WebSocket URL
      const wsUrl = getWebSocketUrl();
      console.log(`Connecting to WebSocket at ${wsUrl}`);
      
      // Create new WebSocket connection
      socketRef.current = new WebSocket(wsUrl);
      
      // Set up event handlers
      socketRef.current.onopen = (event) => {
        console.log('WebSocket connected successfully:', event);
        setIsConnected(true);
        onConnectionStatus?.(true);
        reconnectCount.current = 0; // Reset reconnect counter
        clearReconnectTimeout();
        
        // Subscribe to specific warehouses (if any)
        if (warehouses.length > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          try {
            socketRef.current.send(JSON.stringify({
              type: 'warehouse_update',
              payload: { warehouses }
            }));
          } catch (err) {
            console.error('Error sending warehouse subscription:', err);
          }
        }
      };
      
      socketRef.current.onmessage = (event) => {
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
              if (message.payload.alertType === 'LOW_STOCK') {
                const { item, currentLevel, reorderThreshold } = message.payload;
                toast({
                  title: 'Low Stock Alert',
                  description: `${item.name || 'Item'} is running low (${currentLevel}/${reorderThreshold})`,
                  variant: 'destructive'
                });
              }
              break;
            case 'stock_transfer':
              onStockTransfer?.(message.payload);
              break;
            case 'error':
              console.error('WebSocket error message received:', message.payload);
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
      };
      
      socketRef.current.onclose = (event) => {
        console.log('WebSocket disconnected with code:', event.code, 'reason:', event.reason || 'No reason');
        console.log('WebSocket was clean close?', event.wasClean);
        
        setIsConnected(false);
        onConnectionStatus?.(false);
        
        // Only attempt to reconnect if it wasn't a clean close and we haven't exceeded attempts
        if (!event.wasClean && reconnectCount.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectCount.current += 1;
          
          console.log(`Scheduling reconnect attempt ${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_INTERVAL}ms`);
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Attempting to reconnect (${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS})...`);
            connect();
          }, RECONNECT_INTERVAL);
        } else if (reconnectCount.current >= MAX_RECONNECT_ATTEMPTS) {
          console.log('Maximum reconnect attempts reached, giving up');
          toast({
            title: 'Connection Lost',
            description: 'Could not reconnect to real-time inventory updates.',
            variant: 'destructive'
          });
        }
      };
      
      socketRef.current.onerror = (error) => {
        console.error('WebSocket error event:', error);
        
        // Don't show toast here - let the onclose handle reconnect logic
        // The error event is always followed by a close event
      };
      
    } catch (error) {
      console.error('Error setting up WebSocket connection:', error);
      toast({
        title: 'Connection Error',
        description: 'Failed to establish real-time connection',
        variant: 'destructive'
      });
    }
  }, [getWebSocketUrl, onConnectionStatus, onInventoryUpdate, onStockAlert, onStockTransfer, warehouses, toast, clearReconnectTimeout]);
  
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