import React, { useState } from 'react';
import { RealTimeUpdates } from '@/components/real-time-updates';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Activity, Database, RefreshCw, Server, Settings, Zap } from 'lucide-react';
import { useWebSocket } from '@/hooks/use-websocket';
import { useToast } from '@/hooks/use-toast';

export default function RealTimeUpdatesPage() {
  const [selectedTab, setSelectedTab] = useState<string>('overview');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [itemFilter, setItemFilter] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  
  const { toast } = useToast();
  
  // WebSocket connection setup
  const { isConnected, sendMessage, disconnect, connect } = useWebSocket({
    onConnectionStatus: (status) => {
      setConnectionStatus(status ? 'connected' : 'disconnected');
      addDebugMessage(`Connection status changed to: ${status ? 'connected' : 'disconnected'}`);
    },
  });

  // Add debug messages
  const addDebugMessage = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugMessages(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 100));
  };
  
  // Simulate sending a test message
  const sendTestMessage = (type: string) => {
    if (!isConnected) {
      toast({
        title: 'Not Connected',
        description: 'WebSocket is not connected. Please connect first.',
        variant: 'destructive',
      });
      return;
    }

    let payload: any = {};
    
    switch (type) {
      case 'inventory_update':
        payload = {
          type: 'inventory_update',
          payload: {
            item: { id: 101, name: 'Test Product', sku: 'TP-101' },
            warehouse: { id: 1, name: 'Main Warehouse' },
            quantity: 50,
            previousQuantity: 45,
            updatedBy: 'Test User',
            timestamp: new Date().toISOString(),
          }
        };
        break;
      case 'stock_alert':
        payload = {
          type: 'stock_alert',
          payload: {
            item: { id: 202, name: 'Low Stock Item', sku: 'LS-202' },
            warehouse: { id: 1, name: 'Main Warehouse' },
            currentQuantity: 5,
            threshold: 10,
            alertType: 'LOW_STOCK',
            timestamp: new Date().toISOString(),
          }
        };
        break;
      case 'stock_transfer':
        payload = {
          type: 'stock_transfer',
          payload: {
            item: { id: 303, name: 'Transferred Item', sku: 'TI-303' },
            sourceWarehouse: { id: 1, name: 'Main Warehouse' },
            destinationWarehouse: { id: 2, name: 'Secondary Warehouse' },
            quantity: 15,
            transferredBy: 'Test User',
            timestamp: new Date().toISOString(),
          }
        };
        break;
    }
    
    const success = sendMessage(payload);
    if (success) {
      addDebugMessage(`Sent test ${type} message`);
      toast({
        title: 'Test Message Sent',
        description: `Successfully sent a test ${type.replace('_', ' ')} message.`,
      });
    } else {
      addDebugMessage(`Failed to send test ${type} message`);
      toast({
        title: 'Failed to Send',
        description: 'Unable to send test message. Check connection status.',
        variant: 'destructive',
      });
    }
  };
  
  // Toggle connection
  const toggleConnection = () => {
    if (isConnected) {
      disconnect();
      addDebugMessage('Manually disconnected WebSocket');
    } else {
      connect();
      addDebugMessage('Manually connected WebSocket');
    }
  };
  
  return (
    <div className="container px-4 py-6 mx-auto max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Real-Time Inventory Updates</h1>
        <Badge 
          variant={connectionStatus === 'connected' ? 'default' : 'destructive'}
          className="flex items-center gap-1"
        >
          {connectionStatus === 'connected' 
            ? <Zap className="h-3 w-3" /> 
            : <Server className="h-3 w-3" />}
          {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
        </Badge>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Real-time updates component */}
          <RealTimeUpdates />
          
          {/* Controls panel */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Connection Controls
              </CardTitle>
              <CardDescription>
                Test and manage the real-time connection
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium mb-2">Connection</div>
                  <Button 
                    onClick={toggleConnection}
                    variant={isConnected ? 'destructive' : 'default'}
                    className="w-full"
                  >
                    {isConnected ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
                
                <div className="space-y-2">
                  <div className="text-sm font-medium mb-2">Filter by Warehouse</div>
                  <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Warehouses</SelectItem>
                      <SelectItem value="1">Main Warehouse</SelectItem>
                      <SelectItem value="2">Secondary Warehouse</SelectItem>
                      <SelectItem value="3">Distribution Center</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <div className="text-sm font-medium mb-2">Filter by Item</div>
                  <Input
                    placeholder="Enter item name or SKU"
                    value={itemFilter}
                    onChange={(e) => setItemFilter(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <div className="text-sm font-medium mb-2">Test Messages</div>
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-3 gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => sendTestMessage('inventory_update')}
                        disabled={!isConnected}
                      >
                        Update
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => sendTestMessage('stock_alert')}
                        disabled={!isConnected}
                      >
                        Alert
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => sendTestMessage('stock_transfer')}
                        disabled={!isConnected}
                      >
                        Transfer
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Right column */}
        <div className="space-y-6">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Connection Details
              </CardTitle>
              <CardDescription>
                Technical information and logs
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <Tabs value={selectedTab} onValueChange={setSelectedTab} className="h-full flex flex-col">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="overview">
                    <Activity className="h-4 w-4 mr-2" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="debug">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Debug Log
                  </TabsTrigger>
                </TabsList>
                
                <div className="mt-4 flex-1 overflow-hidden">
                  <TabsContent value="overview" className="h-full">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="text-sm font-medium">Status:</div>
                        <div className="text-sm">
                          <Badge 
                            variant={isConnected ? 'default' : 'outline'} 
                            className="font-normal"
                          >
                            {isConnected ? 'Connected' : 'Disconnected'}
                          </Badge>
                        </div>
                        
                        <div className="text-sm font-medium">Protocol:</div>
                        <div className="text-sm">
                          {window.location.protocol === 'https:' ? 'WSS (Secure)' : 'WS'}
                        </div>
                        
                        <div className="text-sm font-medium">Host:</div>
                        <div className="text-sm truncate">
                          {window.location.host}
                        </div>
                        
                        <div className="text-sm font-medium">Path:</div>
                        <div className="text-sm">/ws</div>
                        
                        <div className="text-sm font-medium">Environment:</div>
                        <div className="text-sm">
                          {window.location.hostname.includes('replit') || window.location.hostname.includes('repl.co')
                            ? 'Replit'
                            : 'Standard Web'
                          }
                        </div>
                        
                        <div className="text-sm font-medium">Reconnect Attempts:</div>
                        <div className="text-sm">5 max</div>
                        
                        <div className="text-sm font-medium">Reconnect Interval:</div>
                        <div className="text-sm">3000ms</div>
                      </div>
                      
                      <div className="pt-4">
                        <div className="text-sm font-medium mb-2">Connection URL:</div>
                        <code className="text-xs break-all block p-2 rounded bg-muted">
                          {`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`}
                        </code>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="debug" className="h-full">
                    <div className="bg-muted rounded-md p-2 h-[400px] overflow-y-auto">
                      {debugMessages.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">
                          No debug messages yet
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {debugMessages.map((msg, idx) => (
                            <div key={idx} className="text-xs font-mono whitespace-pre-wrap">
                              {msg}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}