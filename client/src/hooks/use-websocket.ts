import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { isElectronEnvironment } from '@/lib/electron-bridge';
import { isFeatureEnabled } from '@/lib/config';
import { publishInventoryConnectionState, removeInventoryConnectionState, useSharedInventoryConnectionState, type InventoryConnectionState } from '@/lib/realtime/inventory-connection-status';

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
  forceEnabled?: boolean; // Override feature flag
}

export function useWebSocket({
  warehouses = [], // Default to all warehouses
  onInventoryUpdate,
  onStockAlert,
  onStockTransfer,
  onConnectionStatus,
  forceEnabled = false,
}: UseWebSocketParams = {}) {
  const webSocketsEnabled = forceEnabled || isFeatureEnabled('enableWebSockets');
  const [isConnected, setIsConnected] = useState(false);
  const connectionIdRef = useRef(`inventory-${Math.random().toString(36).slice(2)}`);
  const connectionState = useSharedInventoryConnectionState();
  const setConnectionState = useCallback((state: InventoryConnectionState) => publishInventoryConnectionState(connectionIdRef.current, state), []);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  const mountedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const connectRef = useRef<() => void>(() => undefined);
  const handlersRef = useRef({
    onInventoryUpdate,
    onStockAlert,
    onStockTransfer,
    onConnectionStatus,
    warehouses,
    toast,
  });
  handlersRef.current = {
    onInventoryUpdate,
    onStockAlert,
    onStockTransfer,
    onConnectionStatus,
    warehouses,
    toast,
  };
  
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
      return 'ws://localhost:3000/ws';
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      console.log(`Using browser WebSocket URL: ${url}`);
      return url;
    }
  }, []);
  
  // Connect to the WebSocket server
  const connect = useCallback(() => {
    // If WebSockets are disabled via feature flag, don't connect
    if (!webSocketsEnabled) {
      setConnectionState('disabled');
      console.log('WebSockets are disabled by feature flag. Not connecting.');
      handlersRef.current.onConnectionStatus?.(false);
      return;
    }
    
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
      manualCloseRef.current = false;
      setConnectionState(reconnectCount.current > 0 ? 'reconnecting' : 'connecting');
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
        setConnectionState('connected');
        handlersRef.current.onConnectionStatus?.(true);
        reconnectCount.current = 0; // Reset reconnect counter
        clearReconnectTimeout();
        
        // Subscribe to specific warehouses (if any)
        const subscribedWarehouses = handlersRef.current.warehouses;
        if (subscribedWarehouses.length > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          try {
            socketRef.current.send(JSON.stringify({
              type: 'warehouse_update',
              payload: { warehouses: subscribedWarehouses }
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
              handlersRef.current.onInventoryUpdate?.(message.payload);
              break;
            case 'stock_alert':
              handlersRef.current.onStockAlert?.(message.payload);
              if (message.payload.alertType === 'LOW_STOCK') {
                const { item, currentLevel, reorderThreshold } = message.payload;
                handlersRef.current.toast({
                  title: 'Low Stock Alert',
                  description: `${item.name || 'Item'} is running low (${currentLevel}/${reorderThreshold})`,
                  variant: 'destructive'
                });
              }
              break;
            case 'stock_transfer':
              handlersRef.current.onStockTransfer?.(message.payload);
              break;
            case 'error':
              console.error('WebSocket error message received:', message.payload);
              handlersRef.current.toast({
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
        
        if (!mountedRef.current) return;

        setIsConnected(false);
        const shouldReconnect = !manualCloseRef.current && !event.wasClean && reconnectCount.current < MAX_RECONNECT_ATTEMPTS;
        setConnectionState(shouldReconnect ? 'reconnecting' : 'disconnected');
        handlersRef.current.onConnectionStatus?.(false);
        
        // Only attempt to reconnect if it wasn't a clean close and we haven't exceeded attempts
        if (shouldReconnect) {
          reconnectCount.current += 1;
          
          console.log(`Scheduling reconnect attempt ${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_INTERVAL}ms`);
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Attempting to reconnect (${reconnectCount.current}/${MAX_RECONNECT_ATTEMPTS})...`);
            connectRef.current();
          }, RECONNECT_INTERVAL);
        } else if (!manualCloseRef.current && reconnectCount.current >= MAX_RECONNECT_ATTEMPTS) {
          console.log('Maximum reconnect attempts reached, giving up');
          handlersRef.current.toast({
            title: 'Connection Lost',
            description: 'Could not reconnect to real-time inventory updates.',
            variant: 'destructive'
          });
        }
      };
      
      socketRef.current.onerror = (event) => {
        // Browser WebSocket `error` is an Event with no message; logging it as console.error
        // floods diagnostics with useless "[object Event]" / isTrusted-only payloads. Details
        // arrive on onclose (code/reason). Use debug only for local troubleshooting.
        console.debug("WebSocket transport error (see onclose for code/reason)", event.type);
      };
      
    } catch (error) {
      console.error('Error setting up WebSocket connection:', error);
      handlersRef.current.toast({
        title: 'Connection Error',
        description: 'Failed to establish real-time connection',
        variant: 'destructive'
      });
    }
  }, [getWebSocketUrl, clearReconnectTimeout, setConnectionState, webSocketsEnabled]);

  connectRef.current = connect;
  
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
    manualCloseRef.current = true;
    clearReconnectTimeout();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsConnected(false);
    setConnectionState(webSocketsEnabled ? 'disconnected' : 'disabled');
    handlersRef.current.onConnectionStatus?.(false);
  }, [clearReconnectTimeout, setConnectionState, webSocketsEnabled]);
  
  // Connect when the component mounts
  useEffect(() => {
    const connectionId = connectionIdRef.current;
    mountedRef.current = true;
    connect();
    
    // Clean up the WebSocket connection when the component unmounts
    return () => {
      mountedRef.current = false;
      manualCloseRef.current = true;
      clearReconnectTimeout();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) socket.close();
      removeInventoryConnectionState(connectionId);
    };
  }, [clearReconnectTimeout, connect]);
  
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
    connectionState,
    lastMessage,
    sendMessage,
    connect,
    disconnect,
    webSocketsEnabled
  };
}
