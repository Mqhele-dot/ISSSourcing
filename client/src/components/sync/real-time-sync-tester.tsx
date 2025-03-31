import React, { useState, useEffect, useRef } from 'react';
import { useRealTimeSync, SyncMessageType, SyncMessage, SyncStatus } from '@/hooks/use-real-time-sync';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Send, RefreshCw, ArrowDownToLine, ArrowUpToLine, XCircle, Clock } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { isElectronEnvironment } from '@/lib/electron-bridge';

const MESSAGE_TYPES = [
  { value: SyncMessageType.SYNC_REQUEST, label: 'Sync Request' },
  { value: SyncMessageType.DATA_CHANGE, label: 'Data Change' },
  { value: SyncMessageType.CAPABILITIES, label: 'Capabilities' },
  { value: SyncMessageType.HEARTBEAT, label: 'Heartbeat' },
  { value: SyncMessageType.CONNECTION_INFO, label: 'Connection Info' }
];

const ENTITY_TYPES = [
  { value: 'inventory', label: 'Inventory' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'category', label: 'Category' },
  { value: 'user', label: 'User' },
  { value: 'reorderRequest', label: 'Reorder Request' },
  { value: 'purchaseOrder', label: 'Purchase Order' }
];

const ACTION_TYPES = [
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'bulk', label: 'Bulk Operation' }
];

interface MessageLogItem {
  id: string;
  timestamp: Date;
  message: SyncMessage;
  direction: 'in' | 'out';
}

export function RealTimeSyncTester() {
  const [messageType, setMessageType] = useState<SyncMessageType>(SyncMessageType.HEARTBEAT);
  const [entity, setEntity] = useState('inventory');
  const [action, setAction] = useState('update');
  const [customPayload, setCustomPayload] = useState('{\n  "hello": "world"\n}');
  const [messageLog, setMessageLog] = useState<MessageLogItem[]>([]);
  const [showPayload, setShowPayload] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [testSummary, setTestSummary] = useState({
    messagesSent: 0,
    messagesReceived: 0,
    byMessageType: {} as Record<string, number>,
    startTime: new Date(),
    latency: [] as number[]
  });
  const [latencies, setLatencies] = useState<{timestamp: number, latency: number}[]>([]);
  
  const [status, setStatus] = useState<SyncStatus>(SyncStatus.DISCONNECTED);
  const [connectionInfo, setConnectionInfo] = useState<{clientId?: string}>({});

  const { 
    isConnected,
    isConnecting,
    clientId,
    sendMessage
  } = useRealTimeSync({
    autoConnect: true,
    onMessage: (message) => {
      const newLogItem: MessageLogItem = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        timestamp: new Date(),
        message,
        direction: 'in'
      };
      
      setMessageLog(prev => [...prev, newLogItem]);
      
      // Update test summary
      setTestSummary(prev => {
        const messageType = message.type || 'unknown';
        return {
          ...prev,
          messagesReceived: prev.messagesReceived + 1,
          byMessageType: {
            ...prev.byMessageType,
            [messageType]: (prev.byMessageType[messageType] || 0) + 1
          }
        };
      });
      
      // Measure latency for pong responses
      if (message.type === SyncMessageType.PONG && message.payload?.requestTime) {
        const requestTime = parseInt(message.payload.requestTime);
        const latency = Date.now() - requestTime;
        setTestSummary(prev => ({
          ...prev,
          latency: [...prev.latency, latency]
        }));
        
        setLatencies(prev => [
          ...prev, 
          {timestamp: Date.now(), latency}
        ].slice(-20)); // Keep only last 20 measurements
      }
    }
  });
  
  // Update status and connection info
  useEffect(() => {
    if (isConnecting) {
      setStatus(SyncStatus.CONNECTING);
    } else if (isConnected) {
      setStatus(SyncStatus.CONNECTED);
    } else {
      setStatus(SyncStatus.DISCONNECTED);
    }
    
    if (clientId) {
      setConnectionInfo(prev => ({ ...prev, clientId }));
    }
  }, [isConnected, isConnecting, clientId]);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageLog, autoScroll]);
  
  const handleSendMessage = () => {
    try {
      let payload;
      
      if (messageType === SyncMessageType.DATA_CHANGE) {
        payload = {
          entity,
          action,
          data: JSON.parse(customPayload)
        };
      } else if (messageType === SyncMessageType.SYNC_REQUEST) {
        payload = {
          entities: [entity],
          fullSync: true
        };
      } else if (messageType === SyncMessageType.HEARTBEAT) {
        payload = {
          requestTime: Date.now().toString()
        };
      } else {
        payload = JSON.parse(customPayload);
      }
      
      const message: SyncMessage = {
        type: messageType,
        payload,
        timestamp: new Date().toISOString(),
        sequenceNumber: testSummary.messagesSent + 1
      };
      
      sendMessage(message);
      
      const newLogItem: MessageLogItem = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        timestamp: new Date(),
        message,
        direction: 'out'
      };
      
      setMessageLog(prev => [...prev, newLogItem]);
      
      // Update test summary
      setTestSummary(prev => ({
        ...prev,
        messagesSent: prev.messagesSent + 1,
        byMessageType: {
          ...prev.byMessageType,
          [messageType]: (prev.byMessageType[messageType] || 0) + 1
        }
      }));
    } catch (error) {
      console.error('Failed to send message:', error);
      alert(`Failed to send message: ${(error as Error).message}`);
    }
  };
  
  const clearLog = () => {
    setMessageLog([]);
    setTestSummary({
      messagesSent: 0,
      messagesReceived: 0,
      byMessageType: {},
      startTime: new Date(),
      latency: []
    });
    setLatencies([]);
  };
  
  const handleJsonChange = (value: string) => {
    setCustomPayload(value);
  };
  
  const getPayloadExample = () => {
    switch (messageType) {
      case SyncMessageType.DATA_CHANGE:
        return JSON.stringify({ id: 1, name: "Item Name", quantity: 10 }, null, 2);
      case SyncMessageType.SYNC_REQUEST:
        return JSON.stringify({ entities: ["inventory", "supplier"], fullSync: true }, null, 2);
      case SyncMessageType.CAPABILITIES:
        return JSON.stringify({ 
          supportsCompression: true, 
          maxBatchSize: 100,
          supportedEntities: ["inventory", "supplier", "warehouse"],
          deviceInfo: {
            platform: isElectronEnvironment() ? "electron" : "web",
            version: "1.0.0"
          }
        }, null, 2);
      default:
        return JSON.stringify({ hello: "world" }, null, 2);
    }
  };
  
  const resetPayloadToExample = () => {
    setCustomPayload(getPayloadExample());
  };
  
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };
  
  const getLatencyAvg = () => {
    if (testSummary.latency.length === 0) return 0;
    return Math.round(testSummary.latency.reduce((a, b) => a + b, 0) / testSummary.latency.length);
  };
  
  const getMessageTypeColor = (type: string) => {
    switch (type) {
      case SyncMessageType.SYNC_REQUEST:
      case SyncMessageType.SYNC_RESPONSE:
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
      case SyncMessageType.DATA_CHANGE:
        return "bg-green-500/10 text-green-600 dark:text-green-400";
      case SyncMessageType.SYNC_ERROR:
        return "bg-red-500/10 text-red-600 dark:text-red-400";
      case SyncMessageType.HEARTBEAT:
      case SyncMessageType.PONG:
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400";
      case SyncMessageType.CAPABILITIES:
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
      case SyncMessageType.CONNECTION_INFO:
        return "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400";
    }
  };
  
  return (
    <div className="space-y-4">
      <Tabs defaultValue="send">
        <TabsList className="mb-4">
          <TabsTrigger value="send">Send Messages</TabsTrigger>
          <TabsTrigger value="logs">Message Logs</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>
        
        <TabsContent value="send" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="messageType">Message Type</Label>
                <Select 
                  value={messageType} 
                  onValueChange={(value) => setMessageType(value as SyncMessageType)}
                >
                  <SelectTrigger id="messageType">
                    <SelectValue placeholder="Select message type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MESSAGE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {messageType === SyncMessageType.DATA_CHANGE && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="entity">Entity Type</Label>
                    <Select 
                      value={entity} 
                      onValueChange={setEntity}
                    >
                      <SelectTrigger id="entity">
                        <SelectValue placeholder="Select entity type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ENTITY_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="action">Action Type</Label>
                    <Select 
                      value={action} 
                      onValueChange={setAction}
                    >
                      <SelectTrigger id="action">
                        <SelectValue placeholder="Select action type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              
              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={resetPayloadToExample}
                >
                  Reset to Example
                </Button>
                <Button
                  onClick={handleSendMessage}
                  disabled={status !== SyncStatus.CONNECTED}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send Message
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="payload">
                Payload {messageType === SyncMessageType.DATA_CHANGE ? '(Entity Data)' : ''}
              </Label>
              <Textarea
                id="payload"
                value={customPayload}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="font-mono h-[250px]"
              />
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="logs">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center space-x-2 mb-2 sm:mb-0">
                  <Switch
                    id="show-payload"
                    checked={showPayload}
                    onCheckedChange={setShowPayload}
                  />
                  <Label htmlFor="show-payload" className="ml-2">Show payloads</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-scroll"
                    checked={autoScroll}
                    onCheckedChange={setAutoScroll}
                  />
                  <Label htmlFor="auto-scroll" className="ml-2">Auto-scroll</Label>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={clearLog}>
                <XCircle className="mr-2 h-4 w-4" />
                Clear Log
              </Button>
            </div>
            
            <ScrollArea className="h-[400px] border rounded-md p-4" ref={scrollRef}>
              {messageLog.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-muted-foreground h-full">
                  <p>No messages yet</p>
                  <p className="text-sm">Send a message or wait for server messages</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messageLog.map((item) => (
                    <div key={item.id} className={`p-3 rounded-md ${item.direction === 'out' ? 'bg-muted/50 ml-8' : 'bg-primary/5 mr-8'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          {item.direction === 'out' ? (
                            <ArrowUpToLine className="h-4 w-4 text-blue-500" />
                          ) : (
                            <ArrowDownToLine className="h-4 w-4 text-green-500" />
                          )}
                          <div className={`text-xs px-2 py-1 rounded-full ${getMessageTypeColor(item.message.type)}`}>
                            {item.message.type}
                          </div>
                          {item.message.sequenceNumber && (
                            <Badge variant="outline" className="text-xs">
                              #{item.message.sequenceNumber}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatTime(item.timestamp)}
                        </div>
                      </div>
                      
                      {showPayload && item.message.payload && (
                        <pre className="text-xs bg-background/50 p-2 rounded mt-2 overflow-x-auto">
                          {JSON.stringify(item.message.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </TabsContent>
        
        <TabsContent value="stats">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Connection Statistics</CardTitle>
                <CardDescription>Current session information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-[120px_1fr] md:grid-cols-[150px_1fr] gap-x-4 gap-y-3 text-sm">
                  <div className="text-muted-foreground whitespace-nowrap">Status:</div>
                  <div>{status}</div>
                  
                  <div className="text-muted-foreground whitespace-nowrap">Client ID:</div>
                  <div className="font-mono text-xs overflow-x-auto">{connectionInfo?.clientId || 'Unknown'}</div>
                  
                  <div className="text-muted-foreground whitespace-nowrap">Messages Sent:</div>
                  <div>{testSummary.messagesSent}</div>
                  
                  <div className="text-muted-foreground whitespace-nowrap">Messages Received:</div>
                  <div>{testSummary.messagesReceived}</div>
                  
                  <div className="text-muted-foreground whitespace-nowrap">Average Latency:</div>
                  <div>{getLatencyAvg()}ms</div>
                  
                  <div className="text-muted-foreground whitespace-nowrap">Session Started:</div>
                  <div>{testSummary.startTime.toLocaleTimeString()}</div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Message Types</CardTitle>
                <CardDescription>Breakdown by message type</CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="w-full">
                  {Object.entries(testSummary.byMessageType).length > 0 ? (
                    Object.entries(testSummary.byMessageType).map(([type, count]) => (
                      <AccordionItem value={type} key={type}>
                        <AccordionTrigger className="text-sm">
                          <div className="flex justify-between w-full pr-4">
                            <span>{type}</span>
                            <Badge>{count}</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="text-xs text-muted-foreground">
                            {type === SyncMessageType.HEARTBEAT && (
                              <div>Ping messages used to keep the connection alive and measure latency.</div>
                            )}
                            {type === SyncMessageType.PONG && (
                              <div>Responses to heartbeat messages, used to measure round-trip time.</div>
                            )}
                            {type === SyncMessageType.DATA_CHANGE && (
                              <div>Notifications about data changes that need to be synchronized.</div>
                            )}
                            {type === SyncMessageType.SYNC_REQUEST && (
                              <div>Requests to synchronize data between client and server.</div>
                            )}
                            {type === SyncMessageType.SYNC_RESPONSE && (
                              <div>Data sent in response to sync requests.</div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))
                  ) : (
                    <div className="text-center py-6 text-muted-foreground">
                      No messages exchanged yet
                    </div>
                  )}
                </Accordion>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}