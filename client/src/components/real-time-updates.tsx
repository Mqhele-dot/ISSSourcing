import React, { useState, useEffect } from 'react';
import { useWebSocket, WebSocketMessage } from '@/hooks/use-websocket';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Activity, AlertTriangle, BarChart2, Info, PackageOpen, RefreshCw, Zap, Wifi } from 'lucide-react';
import { isElectronEnvironment } from '@/lib/electron-bridge';
import { setFeatureFlag } from '@/lib/config';

type UpdateItem = {
  id: string;
  type: 'inventory_update' | 'stock_alert' | 'stock_transfer';
  title: string;
  description: string;
  timestamp: Date;
  details?: any;
};

export function RealTimeUpdates() {
  const [isListening, setIsListening] = useState(true);
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [alerts, setAlerts] = useState<UpdateItem[]>([]);
  const [activeTab, setActiveTab] = useState('updates');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const { toast } = useToast();

  // Handle inventory updates
  const handleInventoryUpdate = (payload: any) => {
    const newUpdate: UpdateItem = {
      id: `inv-${Date.now()}`,
      type: 'inventory_update',
      title: `${payload.item?.name || 'Item'} Updated`,
      description: `Quantity is now ${payload.quantity} in ${payload.warehouse?.name || 'warehouse #' + payload.warehouseId}`,
      timestamp: new Date(),
      details: payload
    };
    
    setUpdates(prev => [newUpdate, ...prev].slice(0, 50)); // Keep last 50 updates
  };

  // Handle stock alerts
  const handleStockAlert = (payload: any) => {
    const newAlert: UpdateItem = {
      id: `alert-${Date.now()}`,
      type: 'stock_alert',
      title: `Low Stock: ${payload.item?.name || 'Item'}`,
      description: `Current quantity (${payload.currentQuantity}) is below threshold (${payload.threshold})`,
      timestamp: new Date(),
      details: payload
    };
    
    setAlerts(prev => [newAlert, ...prev].slice(0, 50)); // Keep last 50 alerts
    
    toast({
      title: 'Low Stock Alert',
      description: `${payload.item?.name || 'An item'} is running low on stock.`,
      variant: 'destructive',
    });
  };

  // Handle stock transfers
  const handleStockTransfer = (payload: any) => {
    const newUpdate: UpdateItem = {
      id: `transfer-${Date.now()}`,
      type: 'stock_transfer',
      title: `Stock Transfer: ${payload.item?.name || 'Item'}`,
      description: `${payload.quantity} units transferred from ${payload.sourceWarehouse?.name || 'warehouse #' + payload.sourceWarehouseId} to ${payload.destinationWarehouse?.name || 'warehouse #' + payload.destinationWarehouseId}`,
      timestamp: new Date(),
      details: payload
    };
    
    setUpdates(prev => [newUpdate, ...prev].slice(0, 50)); // Keep last 50 updates
  };

  // Handle connection status changes
  const handleConnectionStatus = (connected: boolean) => {
    setConnectionStatus(connected ? 'connected' : 'disconnected');
    
    if (connected) {
      toast({
        title: 'Real-Time Connected',
        description: 'You are now receiving live inventory updates',
        variant: 'default',
      });
    }
  };

  // Function to enable WebSockets
  const enableWebSockets = () => {
    setFeatureFlag('enableWebSockets', true);
    // Force page refresh to apply feature flag change
    window.location.reload();
  };

  // Connect to WebSocket
  const { isConnected, sendMessage, connect, disconnect, webSocketsEnabled } = useWebSocket({
    warehouses: [], // Subscribe to all warehouses
    onInventoryUpdate: isListening ? handleInventoryUpdate : undefined,
    onStockAlert: isListening ? handleStockAlert : undefined,
    onStockTransfer: isListening ? handleStockTransfer : undefined,
    onConnectionStatus: handleConnectionStatus,
  });

  // Toggle listening on/off
  const toggleListening = () => {
    setIsListening(!isListening);
    if (!isListening) {
      toast({
        title: 'Real-Time Updates Enabled',
        description: 'You will now receive inventory notifications',
      });
    } else {
      toast({
        title: 'Real-Time Updates Paused',
        description: 'You will not receive inventory notifications',
      });
    }
  };

  // Reconnect manually
  const handleReconnect = () => {
    if (!isConnected) {
      setConnectionStatus('connecting');
      connect();
    }
  };

  // Clear all updates
  const clearUpdates = () => {
    if (activeTab === 'updates') {
      setUpdates([]);
    } else {
      setAlerts([]);
    }
  };

  return (
    <Card className="h-full flex flex-col">
      {!webSocketsEnabled && !isElectronEnvironment() && (
        <Alert variant="warning" className="mb-4 mx-6 mt-6">
          <Info className="h-4 w-4" />
          <AlertDescription className="flex flex-col space-y-2">
            <span>Real-time activity updates are currently disabled in development mode.</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={enableWebSockets}
              className="self-start"
            >
              <Wifi className="mr-2 h-4 w-4" />
              Enable Real-Time Activity
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Real-Time Activity
            </CardTitle>
            <CardDescription>
              Live inventory updates and alerts
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant={connectionStatus === 'connected' ? 'default' : connectionStatus === 'connecting' ? 'outline' : 'destructive'}
              className="flex gap-1 items-center"
            >
              {connectionStatus === 'connected' && <Zap className="h-3 w-3" />}
              {connectionStatus === 'connecting' && <RefreshCw className="h-3 w-3 animate-spin" />}
              {connectionStatus === 'disconnected' && <AlertTriangle className="h-3 w-3" />}
              {connectionStatus === 'connected' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </Badge>
            <Button 
              size="sm" 
              variant={isListening ? "default" : "outline"}
              onClick={toggleListening}
            >
              {isListening ? 'Pause' : 'Resume'}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="px-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="updates" className="flex items-center gap-1">
              <PackageOpen className="h-4 w-4" />
              Updates
              {updates.length > 0 && (
                <Badge variant="outline" className="ml-1">{updates.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Alerts
              {alerts.length > 0 && (
                <Badge variant="destructive" className="ml-1">{alerts.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>
        
        <CardContent className="pt-4 flex-1 overflow-hidden">
          <TabsContent value="updates" className="h-full mt-0">
            {updates.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <PackageOpen className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Updates Yet</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Real-time inventory updates will appear here as they happen
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[350px]">
                <div className="space-y-3">
                  {updates.map(update => (
                    <UpdateCard key={update.id} update={update} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
          
          <TabsContent value="alerts" className="h-full mt-0">
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Alerts</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Stock alerts will appear here when items fall below thresholds
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[350px]">
                <div className="space-y-3">
                  {alerts.map(alert => (
                    <Alert 
                      key={alert.id} 
                      variant="destructive"
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-start justify-between">
                        <AlertTitle>{alert.title}</AlertTitle>
                        <span className="text-xs opacity-70">
                          {alert.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <AlertDescription>
                        {alert.description}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
      
      <CardFooter className="flex justify-between pt-0">
        <Button 
          variant="outline" 
          size="sm"
          onClick={clearUpdates}
          disabled={
            (activeTab === 'updates' && updates.length === 0) || 
            (activeTab === 'alerts' && alerts.length === 0)
          }
        >
          Clear {activeTab}
        </Button>
        
        {!isConnected && (
          <Button 
            variant="default" 
            size="sm"
            onClick={handleReconnect}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reconnect
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// Individual update card component
function UpdateCard({ update }: { update: UpdateItem }) {
  // Determine icon based on update type
  const getIcon = () => {
    switch (update.type) {
      case 'inventory_update':
        return <PackageOpen className="h-4 w-4" />;
      case 'stock_transfer':
        return <RefreshCw className="h-4 w-4" />;
      case 'stock_alert':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };
  
  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="flex justify-between items-start">
        <div className="flex gap-2 items-start">
          <div className="p-2 rounded-full bg-primary/10 text-primary mt-0.5">
            {getIcon()}
          </div>
          <div>
            <h4 className="text-sm font-medium">{update.title}</h4>
            <p className="text-sm text-muted-foreground">{update.description}</p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {update.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}