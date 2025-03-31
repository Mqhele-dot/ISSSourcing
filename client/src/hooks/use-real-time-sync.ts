import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { isElectronEnvironment, callElectronBridge } from '@/lib/electron-bridge';
import { isFeatureEnabled } from '@/lib/config';

// Define the types of messages that can be sent/received
export enum SyncMessageType {
  SYNC_REQUEST = 'sync_request',
  SYNC_RESPONSE = 'sync_response',
  SYNC_ERROR = 'sync_error',
  DATA_CHANGE = 'data_change',
  SYNC_COMPLETE = 'sync_complete',
  CAPABILITIES = 'capabilities',
  HEARTBEAT = 'heartbeat',
  PONG = 'pong',
  CONNECTION_INFO = 'connection_info',
  CLIENT_CONNECTED = 'client_connected',
  CLIENT_DISCONNECTED = 'client_disconnected',
  CONNECTION_STATUS = 'connection_status'
}

// Define the status of the synchronization process
export enum SyncStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  SYNCING = 'syncing',
  SYNC_COMPLETE = 'sync_complete',
  SYNC_ERROR = 'sync_error',
  OFFLINE = 'offline'
}

// Define the structure of messages
export interface SyncMessage {
  type: SyncMessageType | string;
  payload?: any;
  timestamp: string;
  clientId?: string | undefined;
  compressed?: boolean;
  sequenceNumber?: number;
}

// Options for the hook
interface UseRealTimeSyncOptions {
  onMessage?: (message: SyncMessage) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error | null) => void;
  autoConnect?: boolean;
  forceEnabled?: boolean; // Override feature flag
}

// Result data when syncing with Electron's local database
interface SyncResult {
  syncedCount: number;
  entities: Record<string, number>;
  duration: number;
  errors: string[];
}

/**
 * Hook for real-time synchronization with the server
 */
export function useRealTimeSync(options: UseRealTimeSyncOptions = {}) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [connectedTimestamp, setConnectedTimestamp] = useState<Date | null>(null);
  const [lastPingTime, setLastPingTime] = useState<number | null>(null);
  const [sequenceNumber, setSequenceNumber] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  
  // Check if real-time sync is enabled via feature flag or forced via options
  const realTimeSyncEnabled = options.forceEnabled || isElectronEnvironment() || isFeatureEnabled('enableRealTimeSync');
  
  // Reset sequence number when disconnected
  useEffect(() => {
    if (!isConnected) {
      setSequenceNumber(0);
    }
  }, [isConnected]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Connect to the WebSocket server
  const connect = useCallback(() => {
    // If real-time sync is disabled via feature flag, don't connect
    if (!realTimeSyncEnabled) {
      console.log('Real-time sync is disabled by feature flag. Not connecting.');
      if (options.onError) {
        options.onError(new Error('Real-time sync is disabled'));
      }
      return;
    }
    
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      return; // Already connecting or connected
    }

    setIsConnecting(true);
    
    try {
      // Determine the WebSocket URL
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      // Create a new WebSocket connection
      const newSocket = new WebSocket(wsUrl);
      
      // Set up event handlers
      newSocket.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setConnectedTimestamp(new Date());
        reconnectAttemptsRef.current = 0;
        
        // Send capabilities message
        sendCapabilitiesMessage(newSocket);
        
        if (options.onConnected) {
          options.onConnected();
        }
      };
      
      newSocket.onmessage = (event) => {
        try {
          const message: SyncMessage = JSON.parse(event.data);
          
          // If the message contains a client ID, save it
          if (message.clientId && !clientId) {
            setClientId(message.clientId);
          }
          
          // Handle heartbeat/ping messages
          if (message.type === SyncMessageType.PONG) {
            const sentTime = message.payload?.time ? new Date(message.payload.time).getTime() : null;
            if (sentTime) {
              setLastPingTime(Date.now() - sentTime);
            }
          }
          
          // Call the onMessage callback if provided
          if (options.onMessage) {
            options.onMessage(message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
          if (options.onError) {
            options.onError(error instanceof Error ? error : new Error('Unknown error'));
          }
        }
      };
      
      newSocket.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        
        if (options.onDisconnected) {
          options.onDisconnected();
        }
        
        // Attempt to reconnect if not closing cleanly and not at max attempts
        if (!event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
      
      newSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (options.onError) {
          options.onError(new Error('WebSocket connection error'));
        }
      };
      
      setSocket(newSocket);
    } catch (error) {
      setIsConnecting(false);
      console.error('Error creating WebSocket:', error);
      if (options.onError) {
        options.onError(error instanceof Error ? error : new Error('Unknown error'));
      }
    }
  }, [socket, clientId, options, realTimeSyncEnabled]);

  // Disconnect from the server
  const disconnect = useCallback(() => {
    if (socket) {
      socket.close();
      setSocket(null);
      setIsConnected(false);
      setIsConnecting(false);
      setClientId(null);
      setConnectedTimestamp(null);
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent auto-reconnect
    }
  }, [socket]);

  // Send a message to the server
  const sendMessage = useCallback((message: Omit<SyncMessage, 'timestamp' | 'sequenceNumber'>): boolean => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    
    try {
      const nextSequence = sequenceNumber + 1;
      setSequenceNumber(nextSequence);
      
      const completeMessage: SyncMessage = {
        ...message,
        timestamp: new Date().toISOString(),
        sequenceNumber: nextSequence,
        clientId: clientId || undefined
      };
      
      socket.send(JSON.stringify(completeMessage));
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }, [socket, clientId, sequenceNumber]);

  // Send capabilities to the server
  const sendCapabilitiesMessage = useCallback((ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      // Collect device information
      const deviceInfo: Record<string, any> = {
        isElectron: isElectronEnvironment(),
        userAgent: navigator.userAgent,
      };
      
      // Add more details if available in modern browsers
      if ('userAgentData' in navigator) {
        const nav = navigator as any;
        deviceInfo.platform = nav.userAgentData?.platform;
        deviceInfo.mobile = nav.userAgentData?.mobile;
        deviceInfo.brands = nav.userAgentData?.brands;
      }
      
      // Add electron-specific details
      if (isElectronEnvironment()) {
        deviceInfo.type = 'desktop';
        
        // Try to get electron process info
        try {
          const process = window.process;
          if (process) {
            deviceInfo.platform = process.platform;
            deviceInfo.arch = process.arch;
            deviceInfo.version = process.version;
          }
        } catch (e) {
          console.warn('Could not access electron process info');
        }
      }
      
      const nextSequence = sequenceNumber + 1;
      setSequenceNumber(nextSequence);
      
      ws.send(JSON.stringify({
        type: SyncMessageType.CAPABILITIES,
        payload: {
          version: '1.0.0',
          features: ['compression', 'offline', 'encryption'],
          deviceInfo
        },
        timestamp: new Date().toISOString(),
        sequenceNumber: nextSequence
      }));
    }
  }, [sequenceNumber]);
  
  // Request connected clients list
  const getConnectedClients = useCallback(() => {
    return sendMessage({
      type: SyncMessageType.CONNECTION_STATUS,
      payload: { requestDetails: true }
    });
  }, [sendMessage]);
  
  // Attempt to sync data with Electron's local database
  const syncData = useCallback(async (): Promise<SyncResult> => {
    if (!isElectronEnvironment()) {
      throw new Error('Sync data is only available in Electron environment');
    }
    
    try {
      const startTime = Date.now();
      
      // Call Electron's syncDatabase method
      const syncSuccess = await callElectronBridge('db', 'syncDatabase');
      
      if (!syncSuccess) {
        throw new Error('Database sync failed');
      }
      
      // Get sync statistics
      const syncInfo = await callElectronBridge('db', 'getSyncInfo');
      const endTime = Date.now();
      
      const formattedResult: SyncResult = {
        syncedCount: syncInfo.totalSynced || 0,
        entities: syncInfo.entityCounts || {},
        duration: endTime - startTime,
        errors: syncInfo.errors || []
      };
      
      return formattedResult;
    } catch (error) {
      console.error('Error syncing data with Electron DB:', error);
      throw error instanceof Error 
        ? error 
        : new Error('Unknown error occurred during sync');
    }
  }, []);

  // Auto-connect if specified
  useEffect(() => {
    if (options.autoConnect) {
      connect();
    }
    
    // Clean up when unmounting
    return () => {
      if (socket) {
        socket.close();
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [options.autoConnect, connect, socket]);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    sendMessage,
    clientId,
    connectedTimestamp,
    latency: lastPingTime,
    getConnectedClients,
    syncData,
    realTimeSyncEnabled
  };
}