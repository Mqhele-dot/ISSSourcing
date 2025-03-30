import React, { useState, useEffect } from 'react';
import { useRealTimeSync } from '@/hooks/use-real-time-sync';
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Wifi, 
  WifiOff, 
  RefreshCw,
  Clock,
  Users,
  Zap,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Smartphone,
  Laptop,
  Monitor,
  Server,
  Globe,
  Timer,
  PieChart
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface ClientInfo {
  id: string;
  lastActivity: string;
  deviceInfo: {
    platform?: string;
    osVersion?: string;
    appVersion?: string;
    networkType?: string;
  };
  isElectron: boolean;
}

interface SyncStats {
  messagesSent: number;
  messagesReceived: number;
  lastMessageTime: Date | null;
  connectionDrops: number;
  ping: number;
  syncEvents: {
    timestamp: Date;
    type: 'connect' | 'disconnect' | 'message' | 'error';
    details?: string;
  }[];
}

export function RealTimeSyncStatus() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [connectedClients, setConnectedClients] = useState<ClientInfo[]>([]);
  const [lastPingTime, setLastPingTime] = useState<number | null>(null);
  const [stats, setStats] = useState<SyncStats>({
    messagesSent: 0,
    messagesReceived: 0,
    lastMessageTime: null,
    connectionDrops: 0,
    ping: 0,
    syncEvents: []
  });

  // Initialize the real-time sync hook
  const { 
    isConnected, 
    clientId, 
    connectedTimestamp, 
    error, 
    connect, 
    disconnect 
  } = useRealTimeSync({
    onMessage: (message) => {
      // Log all messages received
      if (message.type === 'pong') {
        // Calculate ping time
        if (lastPingTime) {
          const pingTime = Date.now() - lastPingTime;
          setStats(prev => ({
            ...prev,
            ping: pingTime
          }));
        }
        setLastPingTime(null);
      } else if (message.type === 'ping') {
        // Just increment counter for ping messages
        setStats(prev => ({
          ...prev,
          messagesReceived: prev.messagesReceived + 1,
          lastMessageTime: new Date()
        }));
      } else if (message.type === 'connection_status') {
        // Update connected clients list
        if (message.data && Array.isArray(message.data.clients)) {
          setConnectedClients(message.data.clients);
        }
        
        setStats(prev => ({
          ...prev,
          messagesReceived: prev.messagesReceived + 1,
          lastMessageTime: new Date(),
          syncEvents: [
            {
              timestamp: new Date(),
              type: 'message',
              details: `Received connection status with ${message.data?.clients?.length || 0} clients`
            },
            ...prev.syncEvents
          ].slice(0, 50) // Keep only last 50 events
        }));
      } else {
        // Handle other message types
        setStats(prev => ({
          ...prev,
          messagesReceived: prev.messagesReceived + 1,
          lastMessageTime: new Date(),
          syncEvents: [
            {
              timestamp: new Date(),
              type: 'message',
              details: `Received ${message.type} message`
            },
            ...prev.syncEvents
          ].slice(0, 50) // Keep only last 50 events
        }));
      }
    },
    onConnected: (id) => {
      toast({
        title: 'Connected',
        description: `WebSocket connection established with ID: ${id.substring(0, 8)}...`,
      });
      
      setStats(prev => ({
        ...prev,
        syncEvents: [
          {
            timestamp: new Date(),
            type: 'connect',
            details: `Connected with ID: ${id.substring(0, 8)}...`
          },
          ...prev.syncEvents
        ].slice(0, 50) // Keep only last 50 events
      }));
    },
    onDisconnected: () => {
      toast({
        title: 'Disconnected',
        description: 'WebSocket connection closed',
        variant: 'destructive',
      });
      
      setStats(prev => ({
        ...prev,
        connectionDrops: prev.connectionDrops + 1,
        syncEvents: [
          {
            timestamp: new Date(),
            type: 'disconnect',
            details: 'Connection closed'
          },
          ...prev.syncEvents
        ].slice(0, 50) // Keep only last 50 events
      }));
    },
    onError: () => {
      setStats(prev => ({
        ...prev,
        syncEvents: [
          {
            timestamp: new Date(),
            type: 'error',
            details: 'WebSocket error occurred'
          },
          ...prev.syncEvents
        ].slice(0, 50) // Keep only last 50 events
      }));
    }
  });

  // Get connection quality based on ping time
  const getConnectionQuality = () => {
    if (!isConnected) return { text: 'Disconnected', color: 'red' };
    if (stats.ping === 0) return { text: 'Unknown', color: 'gray' };
    if (stats.ping < 100) return { text: 'Excellent', color: 'green' };
    if (stats.ping < 200) return { text: 'Good', color: 'green' };
    if (stats.ping < 500) return { text: 'Fair', color: 'yellow' };
    return { text: 'Poor', color: 'red' };
  };

  // Get progress value for connection quality
  const getConnectionQualityProgress = () => {
    if (!isConnected) return 0;
    if (stats.ping === 0) return 50; // Unknown
    if (stats.ping < 100) return 100;
    if (stats.ping < 200) return 80;
    if (stats.ping < 500) return 60;
    if (stats.ping < 1000) return 40;
    return 20;
  };

  // Get device type icon based on client info
  const getDeviceIcon = (client: ClientInfo) => {
    if (client.isElectron) return <Laptop className="h-4 w-4" />;
    
    const userAgent = client.deviceInfo?.platform?.toLowerCase() || '';
    
    if (userAgent.includes('android') || userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('mobile')) {
      return <Smartphone className="h-4 w-4" />;
    } else if (userAgent.includes('windows') || userAgent.includes('macintosh') || userAgent.includes('linux')) {
      return <Monitor className="h-4 w-4" />;
    }
    
    return <Globe className="h-4 w-4" />;
  };

  // Format device info from client
  const formatDeviceInfo = (client: ClientInfo) => {
    if (client.isElectron) {
      return `Electron App${client.deviceInfo?.platform ? ` (${client.deviceInfo.platform})` : ''}`;
    }
    
    const platform = client.deviceInfo?.platform || 'Unknown Device';
    const version = client.deviceInfo?.osVersion ? ` ${client.deviceInfo.osVersion}` : '';
    
    return `${platform}${version}`;
  };

  // Handle connecting
  const handleConnect = () => {
    connect();
  };

  // Handle disconnecting
  const handleDisconnect = () => {
    disconnect();
    
    // Clear connected clients when manually disconnecting
    setConnectedClients([]);
  };

  // Update timestamp every second for relative time displays
  useEffect(() => {
    const timer = setInterval(() => {
      // Force re-render to update relative timestamps
      setStats(prev => ({ ...prev }));
    }, 1000);
    
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              {isConnected ? (
                <Wifi className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <WifiOff className="h-4 w-4 mr-2 text-red-500" />
              )}
              Connection Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center">
              <div>
                <div className="text-2xl font-bold">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {isConnected && connectedTimestamp
                    ? `Connected ${formatDistanceToNow(connectedTimestamp, { addSuffix: true })}`
                    : 'Not connected to server'}
                </div>
              </div>
              <Badge 
                variant={isConnected ? "default" : "outline"} 
                className={isConnected 
                  ? "bg-green-500 hover:bg-green-500" 
                  : "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
                }
              >
                {isConnected ? 'Online' : 'Offline'}
              </Badge>
            </div>
            
            {error && (
              <div className="mt-2 text-xs text-red-500 flex items-center">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {error.message}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <Activity className="h-4 w-4 mr-2 text-primary" />
              Connection Quality
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-2xl font-bold">
                  {getConnectionQuality().text}
                </div>
                <div className="text-sm flex items-center">
                  <Timer className="h-3 w-3 mr-1" />
                  {stats.ping > 0 ? `${stats.ping}ms` : '--'}
                </div>
              </div>
              <Progress 
                value={getConnectionQualityProgress()} 
                className={`h-2 ${
                  !isConnected 
                    ? 'bg-red-100 dark:bg-red-900/20' 
                    : stats.ping < 200 
                      ? 'bg-green-100 dark:bg-green-900/20' 
                      : stats.ping < 500 
                        ? 'bg-yellow-100 dark:bg-yellow-900/20' 
                        : 'bg-red-100 dark:bg-red-900/20'
                }`}
              />
              <div className="text-xs text-muted-foreground mt-1 flex items-center">
                <Zap className="h-3 w-3 mr-1 text-primary" />
                {isConnected 
                  ? stats.connectionDrops > 0 
                    ? `${stats.connectionDrops} connection drops detected` 
                    : 'Stable connection'
                  : 'Connect to see quality metrics'
                }
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center">
              <Users className="h-4 w-4 mr-2 text-primary" />
              Connected Clients
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center">
              <div className="text-2xl font-bold">
                {isConnected ? connectedClients.length : 0}
              </div>
              <div className="text-sm flex items-center">
                <Clock className="h-3 w-3 mr-1" />
                {stats.lastMessageTime 
                  ? formatDistanceToNow(stats.lastMessageTime, { addSuffix: true }) 
                  : 'No messages'
                }
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {isConnected 
                ? connectedClients.length > 0 
                  ? `Your client ID: ${clientId?.substring(0, 8) || 'Unknown'}...` 
                  : 'No other clients connected'
                : 'Connect to see client information'
              }
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="clients">Connected Clients</TabsTrigger>
          <TabsTrigger value="events">Sync Events</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <PieChart className="h-5 w-5 mr-2 text-primary" />
                Sync Overview
              </CardTitle>
              <CardDescription>
                Real-time synchronization statistics and metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-1">Messages</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-primary-50 border border-primary-100 rounded-md p-3 dark:bg-primary-950/20 dark:border-primary-900">
                        <div className="text-xs text-muted-foreground">Sent</div>
                        <div className="text-2xl font-bold">{stats.messagesSent}</div>
                      </div>
                      <div className="bg-green-50 border border-green-100 rounded-md p-3 dark:bg-green-950/20 dark:border-green-900">
                        <div className="text-xs text-muted-foreground">Received</div>
                        <div className="text-2xl font-bold">{stats.messagesReceived}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-sm font-medium mb-1">Connection</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 border border-blue-100 rounded-md p-3 dark:bg-blue-950/20 dark:border-blue-900">
                        <div className="text-xs text-muted-foreground">Status</div>
                        <div className="text-lg font-medium">
                          {isConnected ? (
                            <span className="text-green-600 flex items-center">
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Connected
                            </span>
                          ) : (
                            <span className="text-red-600 flex items-center">
                              <XCircle className="h-4 w-4 mr-1" />
                              Disconnected
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="bg-amber-50 border border-amber-100 rounded-md p-3 dark:bg-amber-950/20 dark:border-amber-900">
                        <div className="text-xs text-muted-foreground">Ping</div>
                        <div className="text-lg font-medium">
                          {isConnected ? (
                            stats.ping > 0 ? (
                              <span className={
                                stats.ping < 200 
                                  ? "text-green-600" 
                                  : stats.ping < 500 
                                    ? "text-amber-600" 
                                    : "text-red-600"
                              }>
                                {stats.ping} ms
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Measuring...</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-1">Connection Details</h3>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">Client ID</TableCell>
                          <TableCell className="font-mono text-xs">
                            {clientId ? clientId : 'Not connected'}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Connected At</TableCell>
                          <TableCell>
                            {connectedTimestamp 
                              ? format(connectedTimestamp, 'PPpp')
                              : 'Not connected'
                            }
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Connected For</TableCell>
                          <TableCell>
                            {connectedTimestamp 
                              ? formatDistanceToNow(connectedTimestamp)
                              : '--'
                            }
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Connection Drops</TableCell>
                          <TableCell>{stats.connectionDrops}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="clients" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Users className="h-5 w-5 mr-2 text-primary" />
                Connected Clients
              </CardTitle>
              <CardDescription>
                All clients currently connected to the real-time sync server
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isConnected ? (
                <div className="text-center py-8 text-muted-foreground">
                  <WifiOff className="h-8 w-8 mx-auto mb-4 opacity-50" />
                  <p>You are not connected to the server</p>
                  <p className="text-sm">Connect to see other clients</p>
                </div>
              ) : connectedClients.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-4 opacity-50" />
                  <p>No clients connected</p>
                  <p className="text-sm">Waiting for server to report connected clients</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Last Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {connectedClients.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            {getDeviceIcon(client)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {client.id === clientId ? (
                            <div className="flex items-center">
                              {client.id.substring(0, 8)}...
                              <Badge variant="outline" className="ml-2 bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                                You
                              </Badge>
                            </div>
                          ) : (
                            `${client.id.substring(0, 8)}...`
                          )}
                        </TableCell>
                        <TableCell>{formatDeviceInfo(client)}</TableCell>
                        <TableCell>
                          {client.isElectron ? (
                            <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800">
                              <Laptop className="h-3 w-3 mr-1" />
                              Desktop
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                              <Globe className="h-3 w-3 mr-1" />
                              Web
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {client.lastActivity
                            ? formatDistanceToNow(new Date(client.lastActivity), { addSuffix: true })
                            : 'Unknown'
                          }
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="events" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Activity className="h-5 w-5 mr-2 text-primary" />
                Sync Events
              </CardTitle>
              <CardDescription>
                Recent synchronization events and messages
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stats.syncEvents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-4 opacity-50" />
                  <p>No sync events recorded</p>
                  <p className="text-sm">Events will appear here as they occur</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Event Type</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.syncEvents.map((event, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            {event.type === 'connect' ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : event.type === 'disconnect' ? (
                              <XCircle className="h-4 w-4 text-red-500" />
                            ) : event.type === 'error' ? (
                              <AlertTriangle className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Activity className="h-4 w-4 text-blue-500" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            event.type === 'connect' 
                              ? "bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
                              : event.type === 'disconnect'
                                ? "bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
                                : event.type === 'error'
                                  ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"
                                  : "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"
                          }>
                            {event.type.charAt(0).toUpperCase() + event.type.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell>{event.details || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CardFooter className="flex justify-between px-0">
        <div>
          <Button
            variant={isConnected ? "outline" : "default"}
            onClick={isConnected ? handleDisconnect : handleConnect}
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
        <div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              setStats({
                messagesSent: 0,
                messagesReceived: 0,
                lastMessageTime: null,
                connectionDrops: 0,
                ping: 0,
                syncEvents: []
              });
              
              toast({
                description: 'Stats have been reset',
              });
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Reset Stats
          </Button>
        </div>
      </CardFooter>
    </div>
  );
}