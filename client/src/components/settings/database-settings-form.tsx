import React, { useState, useEffect, useMemo, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Database, RotateCw, CheckCircle, XCircle, CloudCog, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettings, DatabaseSettings } from "@/hooks/use-settings";
import { isElectronEnvironment, ElectronBridge, DatabaseInfo, BackupResult } from "@/lib/electron-bridge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Define schema for synchronization settings
const syncSettingsSchema = z.object({
  useLocalDB: z.boolean().default(true),
  autoConnect: z.boolean().default(true),
  syncInterval: z.coerce.number().int().min(1, "Min sync interval is 1 minute").max(1440, "Max sync interval is 24 hours (1440 minutes)").optional(),
  offlineMode: z.boolean().default(false).optional(),
  syncOnStartup: z.boolean().default(true).optional(),
  maxOfflineDays: z.coerce.number().int().min(1, "Min is 1 day").max(30, "Max is 30 days").optional(),
  compressionEnabled: z.boolean().default(true).optional(),
});

// Define schema for connection settings
const connectionSettingsSchema = z.object({
  host: z.string().min(1, "Host is required").optional(),
  port: z.string().min(1, "Port is required").optional(),
  username: z.string().min(1, "Username is required").optional(),
  password: z.string().optional(),
  database: z.string().min(1, "Database name is required").optional(),
});

// Combined database settings schema
const databaseSettingsSchema = z.object({
  ...syncSettingsSchema.shape,
  ...connectionSettingsSchema.shape
});

// Type for form data
type DatabaseSettingsFormType = z.infer<typeof databaseSettingsSchema>;

export function DatabaseSettingsForm() {
  const { toast } = useToast();
  const [isElectron, setIsElectron] = useState(isElectronEnvironment());
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const { settings, updateSettings } = useSettings();
  const electronBridge = useMemo(() => new ElectronBridge(), []);
  const [activeTab, setActiveTab] = useState<string>("sync");

  // Create form with default values
  const form = useForm<DatabaseSettingsFormType>({
    resolver: zodResolver(databaseSettingsSchema),
    defaultValues: {
      // Sync settings defaults
      useLocalDB: true,
      autoConnect: true,
      syncInterval: 15,
      offlineMode: false,
      syncOnStartup: true,
      maxOfflineDays: 7,
      compressionEnabled: true,
      
      // Connection settings defaults
      host: "",
      port: "5432",
      username: "",
      password: "",
      database: "",
    },
  });
  
  // Update form with settings if available
  useEffect(() => {
    if (settings && settings.databaseSettings) {
      const dbSettings = settings.databaseSettings as DatabaseSettings;
      form.reset({
        // Sync settings
        useLocalDB: dbSettings.useLocalDB ?? true,
        autoConnect: dbSettings.autoConnect ?? true,
        syncInterval: dbSettings.syncInterval ?? 15,
        offlineMode: dbSettings.offlineMode ?? false,
        syncOnStartup: dbSettings.syncOnStartup ?? true,
        maxOfflineDays: dbSettings.maxOfflineDays ?? 7,
        compressionEnabled: dbSettings.compressionEnabled ?? true,
        
        // Connection settings
        host: dbSettings.host ?? "",
        port: dbSettings.port ?? "5432",
        username: dbSettings.username ?? "",
        password: dbSettings.password ?? "",
        database: dbSettings.database ?? "",
      });
    }
  }, [settings, form]);

  // Check database connection
  const checkDatabaseConnection = useCallback(async () => {
    setDbStatus('checking');
    
    if (isElectron) {
      try {
        // Use the ElectronBridge to check database status
        const dbInfo = await electronBridge.getDatabaseInfo().catch(() => null);
        
        if (dbInfo && dbInfo.status === 'healthy') {
          setDbStatus('connected');
          toast({
            title: "Database Connected",
            description: `Successfully connected to ${dbInfo.database || 'database'}`,
          });
        } else {
          setDbStatus('disconnected');
          toast({
            title: "Database Disconnected",
            description: dbInfo?.error || "Unable to connect to database",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Error checking database connection:', error);
        setDbStatus('disconnected');
        toast({
          title: "Connection Error",
          description: error instanceof Error ? error.message : "Failed to check database connection",
          variant: "destructive",
        });
      }
    } else {
      // If not in Electron, always show as disconnected
      setDbStatus('disconnected');
      toast({
        title: "Not Available",
        description: "Database connections are only available in the desktop application",
        variant: "destructive",
      });
    }
  }, [isElectron, electronBridge, setDbStatus, toast]);
  
  // Manual database synchronization function
  const [isSyncing, setIsSyncing] = useState(false);
  
  const handleManualSync = useCallback(async () => {
    if (!isElectron) {
      toast({
        title: "Not Available",
        description: "Database synchronization is only available in the desktop application",
        variant: "destructive",
      });
      return;
    }
    
    setIsSyncing(true);
    
    try {
      await electronBridge.syncDatabase();
      toast({
        title: "Synchronization Complete",
        description: "Database has been successfully synchronized with the server",
      });
      
      // Re-check the connection after sync
      await checkDatabaseConnection();
    } catch (error) {
      console.error('Error synchronizing database:', error);
      toast({
        title: "Synchronization Failed",
        description: error instanceof Error ? error.message : "Failed to synchronize database",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  }, [isElectron, electronBridge, toast, checkDatabaseConnection]);

  // Check database connection when component mounts
  useEffect(() => {
    if (isElectron) {
      checkDatabaseConnection();
    } else {
      setDbStatus('disconnected');
    }
  }, [isElectron, checkDatabaseConnection]);

  // Submit handler
  const onSubmit = useCallback((data: DatabaseSettingsFormType) => {
    if (isElectron) {
      // Use the window.electron API via the bridge class
      window.electron?.invoke('update-database-settings', data)
        .then(() => {
          // Also update the settings in the application
          if (settings) {
            updateSettings.mutate({
              ...settings,
              databaseSettings: data
            });
          }
          
          toast({
            title: "Database settings updated",
            description: "Database settings have been saved successfully.",
          });
          
          // Re-check the connection status after settings are updated
          setTimeout(() => {
            checkDatabaseConnection();
          }, 1000);
        })
        .catch((error: Error) => {
          toast({
            title: "Error updating database settings",
            description: error.message || "Failed to update database settings",
            variant: "destructive",
          });
        });
    } else {
      // Not in Electron environment
      toast({
        title: "Settings not applied",
        description: "Local database is only available in the desktop application",
        variant: "destructive",
      });
    }
  }, [isElectron, toast, settings, updateSettings, checkDatabaseConnection]);

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Database Settings
            </CardTitle>
            <CardDescription>
              Configure database connection and synchronization settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Database status indicator */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <span className="font-medium">Database Status</span>
              <div className="flex items-center">
                {dbStatus === 'checking' && (
                  <><RotateCw className="h-4 w-4 mr-2 animate-spin text-orange-600" /> Checking...</>
                )}
                {dbStatus === 'connected' && (
                  <><CheckCircle className="h-4 w-4 mr-2 text-green-600" /> Connected</>
                )}
                {dbStatus === 'disconnected' && (
                  <><XCircle className="h-4 w-4 mr-2 text-red-600" /> Disconnected</>
                )}
              </div>
            </div>

            {!isElectron && (
              <div className="rounded-md bg-amber-50 p-4 text-amber-800 dark:bg-amber-950 dark:text-amber-400">
                <p className="font-medium">Desktop Application Required</p>
                <p className="mt-1">
                  Database configuration is only available in the desktop application.
                  These settings will have no effect in the web browser.
                </p>
              </div>
            )}

            <Tabs defaultValue="sync" value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sync">Synchronization</TabsTrigger>
                <TabsTrigger value="connection">Connection</TabsTrigger>
              </TabsList>
              
              {/* Sync Settings Tab */}
              <TabsContent value="sync" className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="useLocalDB"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Use Local Database</FormLabel>
                        <FormDescription>
                          Store inventory data locally for offline access
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={!isElectron}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="autoConnect"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Auto-Connect</FormLabel>
                        <FormDescription>
                          Automatically connect to database on startup
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={!isElectron}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="syncInterval"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sync Interval (minutes)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          disabled={!isElectron || !form.watch("useLocalDB")}
                        />
                      </FormControl>
                      <FormDescription>
                        How often to synchronize local database with the server
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxOfflineDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Offline Days</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          disabled={!isElectron || !form.watch("useLocalDB")}
                        />
                      </FormControl>
                      <FormDescription>
                        Maximum number of days to retain offline data
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="syncOnStartup"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Sync on Startup</FormLabel>
                          <FormDescription>
                            Synchronize when application starts
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            disabled={!isElectron || !form.watch("useLocalDB")}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="compressionEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Data Compression</FormLabel>
                          <FormDescription>
                            Compress local data to save space
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value ?? true}
                            onCheckedChange={field.onChange}
                            disabled={!isElectron || !form.watch("useLocalDB")}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="offlineMode"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 bg-amber-50 dark:bg-amber-950">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base font-medium">Force Offline Mode</FormLabel>
                        <FormDescription>
                          Work offline even when internet is available (for testing)
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value ?? false}
                          onCheckedChange={field.onChange}
                          disabled={!isElectron || !form.watch("useLocalDB")}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </TabsContent>
              
              {/* Connection Settings Tab */}
              <TabsContent value="connection" className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Database Host</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="localhost or IP address" 
                          {...field} 
                          disabled={!isElectron}
                        />
                      </FormControl>
                      <FormDescription>
                        The hostname or IP address of your PostgreSQL server
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Port</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="5432" 
                          {...field} 
                          disabled={!isElectron}
                        />
                      </FormControl>
                      <FormDescription>
                        The port your PostgreSQL server is running on (default: 5432)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Database username" 
                            {...field} 
                            disabled={!isElectron}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="••••••••" 
                            {...field} 
                            disabled={!isElectron}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="database"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Database Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Database name" 
                          {...field} 
                          disabled={!isElectron}
                        />
                      </FormControl>
                      <FormDescription>
                        The name of your PostgreSQL database
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                  <p className="font-medium">Database Connection Security</p>
                  <p className="mt-1">
                    Your database credentials are stored securely within the application and
                    are never transmitted to external servers. All connections are made directly 
                    from your device to the database server.
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <p className="font-medium">About Offline Functionality</p>
              <p className="mt-1">
                The local database allows you to work offline and synchronizes 
                automatically when an internet connection is available. Changes made 
                offline will be uploaded during the next synchronization.
              </p>
            </div>
          </CardContent>
          <CardFooter className="border-t px-6 py-4 flex justify-between">
            <div className="flex gap-2">
              <Button 
                type="button" 
                variant="outline"
                onClick={checkDatabaseConnection}
                disabled={!isElectron}
              >
                Test Connection
              </Button>
              
              <Button 
                type="button" 
                variant="outline"
                onClick={handleManualSync}
                disabled={!isElectron || !form.watch("useLocalDB") || isSyncing}
                className="flex items-center"
              >
                {isSyncing ? (
                  <>
                    <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                    Synchronizing...
                  </>
                ) : (
                  <>
                    <CloudCog className="mr-2 h-4 w-4" />
                    Sync Now
                  </>
                )}
              </Button>
            </div>
            
            <Button 
              type="submit" 
              disabled={!isElectron || updateSettings.isPending}
            >
              {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}