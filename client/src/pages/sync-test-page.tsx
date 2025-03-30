import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { RealTimeSyncStatus } from '@/components/sync/real-time-sync-status';
import { RealTimeSyncTester } from '@/components/sync/real-time-sync-tester';
import { useRealTimeSync } from '@/hooks/use-real-time-sync';

import { 
  InfoIcon, 
  Wifi, 
  WifiOff,
  ExternalLink,
  AlertTriangle
} from 'lucide-react';

export default function SyncTestPage() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  
  const { 
    isConnected, 
    clientId, 
    connect, 
    disconnect 
  } = useRealTimeSync();

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Real-Time Sync Testing</h1>
          <p className="text-muted-foreground">
            Debug and test the real-time synchronization functionality
          </p>
        </div>
        <div>
          <Button
            variant={isConnected ? "outline" : "default"}
            onClick={isConnected ? disconnect : connect}
            className="gap-1"
          >
            {isConnected ? (
              <>
                <WifiOff className="h-4 w-4 mr-1" />
                Disconnect
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4 mr-1" />
                Connect
              </>
            )}
          </Button>
        </div>
      </div>
      
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Development Mode Only</AlertTitle>
        <AlertDescription>
          This page is intended for development and testing purposes only. It allows you to debug and test the real-time synchronization functionality of the system.
        </AlertDescription>
      </Alert>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-start">
              <Badge 
                variant={isConnected ? "default" : "outline"} 
                className={isConnected 
                  ? "bg-green-500 hover:bg-green-500 mb-2" 
                  : "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800 mb-2"
                }
              >
                {isConnected ? 'Connected' : 'Disconnected'}
              </Badge>
              {isConnected && clientId && (
                <div className="text-xs font-mono mt-1 text-muted-foreground">
                  ID: {clientId.substring(0, 16)}...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">WebSocket Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-medium">Endpoint:</span> ws://localhost:3000/ws
              </div>
              <div>
                <span className="font-medium">Protocol:</span> JSON data exchange
              </div>
              <div>
                <span className="font-medium">Persistent ID:</span> UUID v4
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sync Features</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-1">
              <div className="flex items-center">
                <Badge variant="outline" className="mr-2 bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                  Active
                </Badge>
                <span>Real-time data exchange</span>
              </div>
              <div className="flex items-center">
                <Badge variant="outline" className="mr-2 bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                  Active
                </Badge>
                <span>Connection monitoring</span>
              </div>
              <div className="flex items-center">
                <Badge variant="outline" className="mr-2 bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                  Active
                </Badge>
                <span>Auto-reconnect</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2">
          <TabsTrigger value="overview">Connection Status</TabsTrigger>
          <TabsTrigger value="testing">Message Testing</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4">
          <RealTimeSyncStatus />
        </TabsContent>
        
        <TabsContent value="testing" className="space-y-4">
          <RealTimeSyncTester />
        </TabsContent>
      </Tabs>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center">
            <InfoIcon className="h-5 w-5 mr-2 text-primary" />
            About Real-Time Sync
          </CardTitle>
          <CardDescription>
            How the synchronization system works
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-base font-medium mb-2">WebSocket Protocol</h3>
              <p className="text-sm text-muted-foreground mb-4">
                The real-time synchronization system uses WebSockets to establish a persistent 
                connection between the client and server, allowing for bidirectional 
                communication without the overhead of repeated HTTP requests.
              </p>
              
              <h3 className="text-base font-medium mb-2">Message Types</h3>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                <li><span className="font-mono">data_change</span>: Notifies about data changes (create/update/delete)</li>
                <li><span className="font-mono">ping/pong</span>: Keeps the connection alive and measures latency</li>
                <li><span className="font-mono">client_connected</span>: Sent when a client connects</li>
                <li><span className="font-mono">client_disconnected</span>: Sent when a client disconnects</li>
                <li><span className="font-mono">connection_status</span>: Updates on connected clients</li>
              </ul>
            </div>
            
            <div>
              <h3 className="text-base font-medium mb-2">Sync Features</h3>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                <li><b>Auto-reconnect</b>: Automatically reconnects with exponential backoff</li>
                <li><b>Persistent client ID</b>: Maintains stable identity across sessions</li>
                <li><b>Connection quality monitoring</b>: Tracks ping, drops, and status</li>
                <li><b>Client tracking</b>: Shows all connected devices in real-time</li>
                <li><b>Device recognition</b>: Distinguishes between web and Electron clients</li>
                <li><b>Event logging</b>: Records all sync activities for debugging</li>
              </ul>
              
              <h3 className="text-base font-medium mb-4 mt-4">Documentation</h3>
              <Button variant="outline" size="sm" className="gap-1">
                <ExternalLink className="h-4 w-4 mr-1" />
                View API Documentation
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}