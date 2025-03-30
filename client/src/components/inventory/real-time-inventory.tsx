import { useState, useEffect } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, AlertTriangle, ArrowUpDown, RotateCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export function RealTimeInventory() {
  // Fetch warehouses to allow user to choose which ones to monitor
  const { data: warehouses, isLoading: warehousesLoading } = useQuery({
    queryKey: ['/api/warehouses'],
    enabled: true,
  });

  // State for selected warehouses
  const [selectedWarehouses, setSelectedWarehouses] = useState<number[]>([]);
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  const { toast } = useToast();

  // Handle inventory updates from WebSocket
  const handleInventoryUpdate = (payload: any) => {
    // Add to recent updates, keeping only the last 10
    setRecentUpdates(prev => {
      const newUpdates = [payload, ...prev].slice(0, 10);
      return newUpdates;
    });
    setLastUpdateTime(new Date().toLocaleTimeString());
  };

  // Handle stock alerts from WebSocket
  const handleStockAlert = (payload: any) => {
    const { item, warehouse, currentLevel, reorderThreshold } = payload;
    toast({
      title: `Low Stock Alert: ${item.name}`,
      description: `Current level: ${currentLevel}, Threshold: ${reorderThreshold} in ${warehouse.name || 'warehouse #' + warehouse.warehouseId}`,
      variant: 'destructive'
    });
  };

  // Connect to WebSocket for real-time updates
  const { isConnected, lastMessage } = useWebSocket({
    warehouses: selectedWarehouses,
    onInventoryUpdate: handleInventoryUpdate,
    onStockAlert: handleStockAlert,
    onConnectionStatus: (connected) => {
      if (connected) {
        toast({
          title: 'Connected',
          description: 'Real-time inventory synchronization is active',
          variant: 'default'
        });
      }
    }
  });

  // Handle warehouse selection change
  const handleWarehouseChange = (value: string) => {
    if (value === 'all') {
      // Monitor all warehouses
      setSelectedWarehouses([]);
    } else {
      setSelectedWarehouses([parseInt(value)]);
    }
  };

  // Determine connection status display
  let connectionStatus = (
    <Badge variant="outline" className="bg-gray-100 text-gray-500">
      <RotateCw className="w-3 h-3 mr-1 animate-spin" />
      Connecting...
    </Badge>
  );
  
  if (isConnected) {
    connectionStatus = (
      <Badge variant="outline" className="bg-green-50 text-green-700">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Connected
      </Badge>
    );
  } else if (lastMessage) {
    connectionStatus = (
      <Badge variant="outline" className="bg-red-50 text-red-700">
        <AlertCircle className="w-3 h-3 mr-1" />
        Disconnected
      </Badge>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Real-Time Inventory Updates</CardTitle>
            <CardDescription>Live inventory changes across warehouses</CardDescription>
          </div>
          {connectionStatus}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-sm font-medium">Monitor:</span>
            {warehousesLoading ? (
              <Skeleton className="h-9 w-40" />
            ) : (
              <Select 
                defaultValue="all" 
                onValueChange={handleWarehouseChange}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Warehouses</SelectItem>
                  {warehouses && Array.isArray(warehouses) ? warehouses.map((warehouse: any) => (
                    <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                      {warehouse.name}
                    </SelectItem>
                  )) : null}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        
        {recentUpdates.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No recent updates</AlertTitle>
            <AlertDescription>
              Inventory changes will appear here in real-time
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {recentUpdates.map((update, index) => (
              <div 
                key={index} 
                className="border rounded-md p-3 bg-slate-50 text-sm flex justify-between items-start"
              >
                <div>
                  <div className="font-medium">{update.item.name}</div>
                  <div className="text-muted-foreground">
                    Quantity: {update.currentQuantity} in {update.warehouseName}
                  </div>
                </div>
                <div className="flex items-center">
                  {update.previousQuantity !== undefined && (
                    <Badge variant={update.currentQuantity > update.previousQuantity ? "default" : "destructive"} 
                      className={update.currentQuantity > update.previousQuantity ? "bg-green-100 text-green-800 hover:bg-green-200" : ""}>
                      <ArrowUpDown className="w-3 h-3 mr-1" />
                      {update.currentQuantity > update.previousQuantity 
                        ? `+${update.currentQuantity - update.previousQuantity}`
                        : `${update.currentQuantity - update.previousQuantity}`
                      }
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {lastUpdateTime && (
        <CardFooter className="text-xs text-muted-foreground">
          Last updated: {lastUpdateTime}
        </CardFooter>
      )}
    </Card>
  );
}