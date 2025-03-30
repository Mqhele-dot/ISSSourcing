import React, { useState, useRef, useEffect } from 'react';
import { useRealTimeSync } from '@/hooks/use-real-time-sync';
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { 
  Wifi, 
  WifiOff, 
  Send,
  Trash2,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  MessageSquare,
  AlertTriangle,
  Clock,
  Copy,
  CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';

interface MessageLog {
  id: string;
  timestamp: Date;
  direction: 'sent' | 'received';
  messageType: string;
  content: any;
}

export function RealTimeSyncTester() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('send');
  const [entity, setEntity] = useState<string>('inventory');
  const [action, setAction] = useState<'create' | 'update' | 'delete'>('update');
  const [message, setMessage] = useState<string>('{\n  "id": 1,\n  "name": "Test Item",\n  "quantity": 10\n}');
  const [messageType, setMessageType] = useState<string>('data_change');
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const messageLogContainerRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = () => {
    if (messageLogContainerRef.current) {
      messageLogContainerRef.current.scrollTop = messageLogContainerRef.current.scrollHeight;
    }
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messageLogs]);
  
  // Initialize the real-time sync hook
  const { 
    isConnected, 
    clientId, 
    sendDataChange 
  } = useRealTimeSync({
    onMessage: (message) => {
      // Log all messages received
      const newLog: MessageLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date(),
        direction: 'received',
        messageType: message.type,
        content: message,
      };
      
      setMessageLogs((prev) => [...prev, newLog]);
    },
    onConnected: (id) => {
      const newLog: MessageLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date(),
        direction: 'received',
        messageType: 'connection',
        content: { message: `Connected with ID: ${id}` },
      };
      
      setMessageLogs((prev) => [...prev, newLog]);
    },
    onDisconnected: () => {
      const newLog: MessageLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date(),
        direction: 'received',
        messageType: 'disconnection',
        content: { message: 'Disconnected from server' },
      };
      
      setMessageLogs((prev) => [...prev, newLog]);
    },
    onError: (error) => {
      const newLog: MessageLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date(),
        direction: 'received',
        messageType: 'error',
        content: { message: 'WebSocket error occurred', error },
      };
      
      setMessageLogs((prev) => [...prev, newLog]);
    }
  });

  const handleSendMessage = () => {
    if (!isConnected) {
      setError('Cannot send message: WebSocket not connected');
      
      toast({
        title: 'Connection required',
        description: 'Please connect to the server before sending messages',
        variant: 'destructive',
      });
      
      return;
    }
    
    try {
      let parsedMessage;
      
      try {
        // Parse the message as JSON to validate
        parsedMessage = JSON.parse(message);
      } catch (error) {
        setError('Invalid JSON format');
        
        toast({
          title: 'Invalid JSON',
          description: 'Please provide a valid JSON object',
          variant: 'destructive',
        });
        
        return;
      }
      
      if (messageType === 'data_change') {
        // Send data change message
        const result = sendDataChange(entity, action, parsedMessage);
        
        if (result) {
          // Log the sent message
          const newLog: MessageLog = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date(),
            direction: 'sent',
            messageType: 'data_change',
            content: {
              type: 'data_change',
              entity,
              action,
              data: parsedMessage,
              clientId,
              timestamp: Date.now(),
            },
          };
          
          setMessageLogs((prev) => [...prev, newLog]);
          
          setError(null);
          
          toast({
            title: 'Message sent',
            description: `Data change message for ${entity} sent successfully`,
          });
        } else {
          setError('Failed to send message');
          
          toast({
            title: 'Send failed',
            description: 'Failed to send the message. Check console for details.',
            variant: 'destructive',
          });
        }
      } else {
        setError('Unsupported message type. Only data_change is supported for sending.');
        
        toast({
          title: 'Unsupported type',
          description: 'Only data_change messages are supported for manual sending',
          variant: 'warning',
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setError(`Error sending message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      toast({
        title: 'Error',
        description: 'An error occurred while sending the message',
        variant: 'destructive',
      });
    }
  };
  
  const handleClearLogs = () => {
    setMessageLogs([]);
    setError(null);
    
    toast({
      description: 'Message logs cleared',
    });
  };
  
  const handleCopyLogs = () => {
    const logText = messageLogs.map(log => {
      return `[${format(log.timestamp, 'HH:mm:ss')}] ${log.direction.toUpperCase()} - ${log.messageType}: ${JSON.stringify(log.content, null, 2)}`;
    }).join('\n\n');
    
    navigator.clipboard.writeText(logText)
      .then(() => {
        setCopied(true);
        
        toast({
          description: 'Logs copied to clipboard',
        });
        
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy logs:', err);
        
        toast({
          title: 'Copy failed',
          description: 'Failed to copy logs to clipboard',
          variant: 'destructive',
        });
      });
  };
  
  const defaultEntityOptions = [
    { value: 'inventory', label: 'Inventory' },
    { value: 'users', label: 'Users' },
    { value: 'orders', label: 'Orders' },
    { value: 'suppliers', label: 'Suppliers' },
    { value: 'categories', label: 'Categories' },
    { value: 'warehouses', label: 'Warehouses' },
    { value: 'settings', label: 'Settings' },
  ];
  
  const getDirectionIcon = (direction: 'sent' | 'received') => {
    return direction === 'sent' 
      ? <ArrowUp className="h-4 w-4 text-blue-500" /> 
      : <ArrowDown className="h-4 w-4 text-green-500" />;
  };
  
  const getMessageTypeColor = (type: string) => {
    switch (type) {
      case 'data_change':
        return 'bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
      case 'connection':
        return 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
      case 'disconnection':
        return 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      case 'ping':
      case 'pong':
        return 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/20 dark:text-gray-400 dark:border-gray-700';
      case 'error':
        return 'bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800';
      case 'connection_status':
        return 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800';
      default:
        return 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="send" value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2">
          <TabsTrigger value="send">Send Messages</TabsTrigger>
          <TabsTrigger value="logs">Message Logs</TabsTrigger>
        </TabsList>
        
        <TabsContent value="send" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Send className="h-5 w-5 mr-2 text-primary" />
                Send Test Messages
              </CardTitle>
              <CardDescription>
                Manually send messages to test real-time synchronization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="messageType">Message Type</Label>
                    <Select
                      value={messageType}
                      onValueChange={setMessageType}
                      disabled={!isConnected}
                    >
                      <SelectTrigger id="messageType">
                        <SelectValue placeholder="Select message type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="data_change">Data Change</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="entity">Entity</Label>
                    <Select
                      value={entity}
                      onValueChange={setEntity}
                      disabled={!isConnected || messageType !== 'data_change'}
                    >
                      <SelectTrigger id="entity">
                        <SelectValue placeholder="Select entity" />
                      </SelectTrigger>
                      <SelectContent>
                        {defaultEntityOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {messageType === 'data_change' && (
                  <div className="space-y-2">
                    <Label htmlFor="action">Action</Label>
                    <Select
                      value={action}
                      onValueChange={(value) => setAction(value as 'create' | 'update' | 'delete')}
                      disabled={!isConnected}
                    >
                      <SelectTrigger id="action">
                        <SelectValue placeholder="Select action" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="create">Create</SelectItem>
                        <SelectItem value="update">Update</SelectItem>
                        <SelectItem value="delete">Delete</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="message">Message Payload (JSON)</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="font-mono text-sm"
                    rows={10}
                    disabled={!isConnected}
                    placeholder="Enter JSON payload..."
                  />
                </div>
                
                {error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <div>
                <Badge 
                  variant={isConnected ? "default" : "outline"} 
                  className={isConnected 
                    ? "bg-green-500 hover:bg-green-500" 
                    : "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"
                  }
                >
                  {isConnected ? (
                    <Wifi className="h-3 w-3 mr-1" />
                  ) : (
                    <WifiOff className="h-3 w-3 mr-1" />
                  )}
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
              <Button 
                onClick={handleSendMessage}
                disabled={!isConnected}
                className="space-x-1"
              >
                <Send className="h-4 w-4 mr-1" />
                Send Message
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        
        <TabsContent value="logs" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-lg flex items-center">
                    <MessageSquare className="h-5 w-5 mr-2 text-primary" />
                    Message Logs
                  </CardTitle>
                  <CardDescription>
                    History of sent and received WebSocket messages
                  </CardDescription>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm" onClick={handleClearLogs}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCopyLogs}>
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 mr-1 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4 mr-1" />
                    )}
                    Copy
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div 
                ref={messageLogContainerRef}
                className="border rounded-md h-[400px] overflow-y-auto p-4 space-y-2 bg-muted/20"
              >
                {messageLogs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-20" />
                      <p>No message logs yet</p>
                      <p className="text-sm">Send or receive messages to see them here</p>
                    </div>
                  </div>
                ) : (
                  messageLogs.map((log) => (
                    <div 
                      key={log.id} 
                      className={`p-3 border rounded-md ${
                        log.direction === 'sent' 
                          ? 'bg-blue-50 border-blue-100 dark:bg-blue-900/10 dark:border-blue-800/30' 
                          : 'bg-green-50 border-green-100 dark:bg-green-900/10 dark:border-green-800/30'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center space-x-2">
                          {getDirectionIcon(log.direction)}
                          <Badge 
                            variant="outline" 
                            className={getMessageTypeColor(log.messageType)}
                          >
                            {log.messageType}
                          </Badge>
                          <span className="text-xs font-medium">
                            {log.direction === 'sent' ? 'Sent' : 'Received'}
                          </span>
                        </div>
                        <div className="flex items-center text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 mr-1" />
                          {format(log.timestamp, 'HH:mm:ss')}
                        </div>
                      </div>
                      <pre className="text-xs overflow-x-auto p-2 bg-background/80 border rounded-sm">
                        {JSON.stringify(log.content, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}