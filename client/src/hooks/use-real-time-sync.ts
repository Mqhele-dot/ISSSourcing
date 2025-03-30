import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

interface SyncMessage {
  type: 'data_change' | 'ping' | 'pong' | 'client_connected' | 'client_disconnected' | 'connection_status';
  clientId?: string;
  data?: any;
  timestamp?: number;
  entity?: string;
  action?: 'create' | 'update' | 'delete';
}

interface RealTimeSyncOptions {
  autoConnect?: boolean;
  onMessage?: (message: SyncMessage) => void;
  onDataChange?: (entity: string, action: 'create' | 'update' | 'delete', data: any) => void;
  onConnected?: (clientId: string) => void;
  onDisconnected?: () => void;
  onError?: (error: Event) => void;
  pingInterval?: number;
}

interface SyncState {
  isConnected: boolean;
  clientId: string | null;
  connectedTimestamp: number | null;
  socket: WebSocket | null;
  error: Error | null;
}

export function useRealTimeSync(options: RealTimeSyncOptions = {}) {
  const {
    autoConnect = false,
    onMessage,
    onDataChange,
    onConnected,
    onDisconnected,
    onError,
    pingInterval = 30000, // Default ping interval: 30 seconds
  } = options;

  const [state, setState] = useState<SyncState>({
    isConnected: false,
    clientId: null,
    connectedTimestamp: null,
    socket: null,
    error: null,
  });

  const pingIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const deviceInfoRef = useRef<any>({
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown',
    osVersion: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
    appVersion: typeof navigator !== 'undefined' ? navigator.appVersion : 'Unknown',
    networkType: 'Unknown',
  });

  // Check for Electron
  const isElectronApp = typeof window !== 'undefined' && 
    typeof window.process === 'object' && 
    window.process.type === 'renderer';

  // Generate a stable client ID that persists between page reloads
  const clientIdRef = useRef<string>(() => {
    // Try to get from localStorage first
    const savedId = typeof localStorage !== 'undefined' ? localStorage.getItem('sync_client_id') : null;
    
    if (savedId) {
      return savedId;
    }

    // Generate a new ID if none exists
    const newId = uuidv4();
    
    // Save to localStorage for persistence
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sync_client_id', newId);
    }
    
    return newId;
  });

  // Function to connect to the WebSocket server
  const connect = useCallback(() => {
    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear any existing websocket
    if (state.socket) {
      state.socket.close();
    }

    try {
      // Determine the WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      // Create a new WebSocket connection
      const socket = new WebSocket(wsUrl);
      
      // Update state with the new socket
      setState(prev => ({
        ...prev,
        socket,
        error: null,
      }));

      // Set up event handlers
      socket.onopen = () => {
        console.log('WebSocket connection established');
        reconnectAttemptsRef.current = 0;
        
        const connectionTimestamp = Date.now();
        const clientId = clientIdRef.current;
        
        // Send initial connection message with client info
        const connectionMessage: SyncMessage = {
          type: 'client_connected',
          clientId,
          timestamp: connectionTimestamp,
          data: {
            deviceInfo: deviceInfoRef.current,
            isElectron: isElectronApp,
          }
        };
        
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(connectionMessage));
        }
        
        // Set up ping interval for keeping connection alive
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        
        pingIntervalRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            const pingMessage: SyncMessage = {
              type: 'ping',
              clientId,
              timestamp: Date.now(),
            };
            socket.send(JSON.stringify(pingMessage));
          }
        }, pingInterval);
        
        // Update state with connection info
        setState(prev => ({
          ...prev,
          isConnected: true,
          clientId,
          connectedTimestamp: connectionTimestamp,
          error: null,
        }));
        
        // Call the onConnected callback if provided
        if (onConnected) {
          onConnected(clientId);
        }
      };
      
      socket.onmessage = (event: MessageEvent) => {
        try {
          const message: SyncMessage = JSON.parse(event.data);
          
          // Call the onMessage callback if provided
          if (onMessage) {
            onMessage(message);
          }
          
          // Handle specific message types
          if (message.type === 'data_change' && onDataChange && message.entity && message.action && message.clientId !== state.clientId) {
            onDataChange(message.entity, message.action, message.data);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      socket.onclose = (event) => {
        console.log('WebSocket connection closed', event.code, event.reason);
        
        // Clean up
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        
        // Update state
        setState(prev => ({
          ...prev,
          isConnected: false,
          socket: null,
        }));
        
        // Call the onDisconnected callback if provided
        if (onDisconnected) {
          onDisconnected();
        }
        
        // Auto-reconnect logic (with exponential backoff)
        const maxReconnectDelay = 30000; // 30 seconds max
        const baseDelay = 1000; // Start with 1 second
        
        const reconnectDelay = Math.min(
          maxReconnectDelay,
          baseDelay * Math.pow(2, reconnectAttemptsRef.current)
        );
        
        reconnectAttemptsRef.current += 1;
        
        // Only reconnect if we haven't explicitly called disconnect
        if (event.code !== 1000) {
          console.log(`Reconnecting in ${reconnectDelay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutRef.current = window.setTimeout(connect, reconnectDelay);
        }
      };
      
      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        
        setState(prev => ({
          ...prev,
          error: new Error('WebSocket connection error'),
        }));
        
        // Call the onError callback if provided
        if (onError) {
          onError(error);
        }
      };
    } catch (error) {
      console.error('Error setting up WebSocket:', error);
      
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error : new Error('Unknown error setting up WebSocket'),
      }));
    }
  }, [onConnected, onDataChange, onDisconnected, onError, onMessage, pingInterval, state.clientId, state.socket]);

  // Function to disconnect from the WebSocket server
  const disconnect = useCallback(() => {
    // Clean up any pending timeouts or intervals
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    
    // Only attempt to close the socket if it exists and is connected
    if (state.socket && state.isConnected) {
      try {
        // Send a disconnect message before closing
        const disconnectMessage: SyncMessage = {
          type: 'client_disconnected',
          clientId: state.clientId,
          timestamp: Date.now(),
        };
        
        if (state.socket.readyState === WebSocket.OPEN) {
          state.socket.send(JSON.stringify(disconnectMessage));
          
          // Close the connection with a normal closure code
          state.socket.close(1000, 'Client initiated disconnect');
        }
      } catch (error) {
        console.error('Error during disconnect:', error);
      }
    }
    
    // Update state
    setState(prev => ({
      ...prev,
      isConnected: false,
      socket: null,
    }));
  }, [state.clientId, state.isConnected, state.socket]);

  // Send a data change message to the server
  const sendDataChange = useCallback(
    (entity: string, action: 'create' | 'update' | 'delete', data: any): boolean => {
      if (!state.socket || !state.isConnected) {
        console.warn('Cannot send data change: WebSocket not connected');
        return false;
      }
      
      try {
        // Create the data change message
        const message: SyncMessage = {
          type: 'data_change',
          clientId: state.clientId,
          timestamp: Date.now(),
          entity,
          action,
          data,
        };
        
        // Send the message if the socket is open
        if (state.socket.readyState === WebSocket.OPEN) {
          state.socket.send(JSON.stringify(message));
          return true;
        } else {
          console.warn('WebSocket not in OPEN state', state.socket.readyState);
          return false;
        }
      } catch (error) {
        console.error('Error sending data change:', error);
        return false;
      }
    },
    [state.clientId, state.isConnected, state.socket]
  );

  // Auto-connect if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    
    // Clean up on unmount
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (state.socket) {
        state.socket.close();
      }
    };
  }, [autoConnect, connect, state.socket]);

  return {
    isConnected: state.isConnected,
    clientId: state.clientId,
    connectedTimestamp: state.connectedTimestamp ? new Date(state.connectedTimestamp) : null,
    error: state.error,
    connect,
    disconnect,
    sendDataChange,
  };
}