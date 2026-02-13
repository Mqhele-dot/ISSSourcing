import React, { useState, useEffect } from 'react';
import { useRealTimeSync, SyncMessageType, SyncMessage } from '@/hooks/use-real-time-sync';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Check, AlertCircle, Database, Wifi, WifiOff, RefreshCw, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  PlayIcon, 
  StopIcon, 
  ReloadIcon, 
  ClockIcon
} from '@radix-ui/react-icons';
import { isElectronEnvironment } from '@/lib/electron-bridge';
import { isFeatureEnabled, setFeatureFlag } from '@/lib/config';

interface RealTimeSyncStatusProps {
  showDebugInfo?: boolean;
}

export function RealTimeSyncStatus({ showDebugInfo = false }: RealTimeSyncStatusProps) {
  // Initialize state values with default props that might not exist on the hook yet
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);
  
  const { 
    isConnected,
    isConnecting,
    connect,
    disconnect,
    syncData,
    clientId,
    realTimeSyncEnabled
  } = useRealTimeSync({
    autoConnect: true
  });

  const [isElectron, setIsElectron] = useState(false);
  
  useEffect(() => {
    setIsElectron(isElectronEnvironment());
  }, []);

  const handleConnect = () => {
    connect();
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const handleSync = async () => {
    try {
      setSyncInProgress(true);
      setSyncProgress(0.25);
      await syncData();
      setLastSyncTime(Date.now());
      setSyncProgress(1);
      setTimeout(() => {
        setSyncInProgress(false);
      }, 500);
    } catch (error) {
      console.error('Sync failed:', error);
      setLastSyncError(error instanceof Error ? error.message : 'Unknown error');
      setSyncInProgress(false);
    }
  };
  
  // Function to enable WebSockets
  const enableRealTimeSync = () => {
    setFeatureFlag('enableRealTimeSync', true);
    // Force page refresh to apply feature flag change
    window.location.reload();
  };

  // Format the last sync time
  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Connection status badges
  const renderStatusBadge = () => {
    if (isConnecting) {
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Connecting
        </Badge>
      );
    }
    
    if (isConnected) {
      return (
        <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
          <Check className="h-3 w-3 mr-1" />
          Connected
        </Badge>
      );
    }
    
    return (
      <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertCircle className="h-3 w-3 mr-1" />
        Disconnected
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {!realTimeSyncEnabled && !isElectron && (
        <Alert variant="warning" className="mb-4">
          <Info className="h-4 w-4" />
          <AlertDescription className="flex flex-col space-y-2">
            <span>Real-time synchronization is currently disabled in development mode.</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={enableRealTimeSync}
              className="self-start"
            >
              <Wifi className="mr-2 h-4 w-4" />
              Enable Real-Time Sync
            </Button>
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="h-5 w-5 text-green-500" />
          ) : (
            <WifiOff className="h-5 w-5 text-red-500" />
          )}
          <div>
            <div className="text-sm font-medium">Server Connection</div>
            <div className="text-xs text-muted-foreground">
              {isElectron ? 'Desktop sync enabled' : 'Web client'}
            </div>
          </div>
        </div>
        {renderStatusBadge()}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="text-muted-foreground">Last sync:</div>
        <div className="flex items-center">
          <ClockIcon className="h-3 w-3 mr-1" />
          {formatTime(lastSyncTime)}
        </div>
        
        <div className="text-muted-foreground">Pending changes:</div>
        <div>{pendingChanges}</div>
      </div>

      {syncInProgress && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>Syncing data...</span>
            <span>{Math.round(syncProgress * 100)}%</span>
          </div>
          <Progress value={syncProgress * 100} className="h-1.5" />
        </div>
      )}

      {lastSyncError && (
        <div className="mt-2 px-2 py-1.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded text-xs">
          <AlertCircle className="h-3 w-3 inline mr-1" />
          {lastSyncError}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 pt-2">
        <Button
          variant="outline" 
          size="sm"
          className="h-8"
          onClick={handleConnect}
          disabled={isConnected || isConnecting}
        >
          <PlayIcon className="h-3.5 w-3.5 mr-1" />
          Connect
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={handleDisconnect}
          disabled={!isConnected}
        >
          <StopIcon className="h-3.5 w-3.5 mr-1" />
          Disconnect
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={handleSync}
          disabled={!isConnected || syncInProgress}
        >
          <ReloadIcon className="h-3.5 w-3.5 mr-1" />
          Sync Now
        </Button>
      </div>

      {showDebugInfo && (
        <Card className="mt-2">
          <CardContent className="py-3 px-3 text-xs">
            <h4 className="font-semibold mb-2 text-xs flex items-center">
              <Database className="h-3 w-3 mr-1 inline" />
              Debug Information
            </h4>
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Environment:</span>
                <span>{isElectron ? 'Electron Desktop' : 'Web Browser'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">WebSockets Enabled:</span>
                <span>{realTimeSyncEnabled ? 'Yes' : 'No'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Connection:</span>
                <span>{isConnected ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Sync Status:</span>
                <span>{syncInProgress ? 'In Progress' : 'Idle'}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <span className="text-muted-foreground">Last Error:</span>
                <span className="truncate">{lastSyncError || 'None'}</span>
              </div>
              {clientId && (
                <div className="grid grid-cols-2 gap-1">
                  <span className="text-muted-foreground">Client ID:</span>
                  <span className="truncate">{clientId}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}