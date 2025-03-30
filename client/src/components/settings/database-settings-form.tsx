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
import { Loader2, Database, RotateCw, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import { isElectronEnvironment, ElectronBridge } from "@/lib/electron-bridge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Define schema for form validation
const databaseSettingsSchema = z.object({
  localDatabaseEnabled: z.boolean().default(true),
  syncInterval: z.coerce.number().int().min(1, "Min sync interval is 1 minute").max(1440, "Max sync interval is 24 hours (1440 minutes)"),
  offlineMode: z.boolean().default(false),
  syncOnStartup: z.boolean().default(true),
  maxOfflineDays: z.coerce.number().int().min(1, "Min is 1 day").max(30, "Max is 30 days"),
  compressionEnabled: z.boolean().default(true),
});

// Type for form data
type DatabaseSettingsFormType = z.infer<typeof databaseSettingsSchema>;

export function DatabaseSettingsForm() {
  const { toast } = useToast();
  const [isElectron, setIsElectron] = useState(isElectronEnvironment());
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const { settings, updateSettings } = useSettings();
  const electronBridge = useMemo(() => new ElectronBridge(), []);

  // Create form with default values
  const form = useForm<DatabaseSettingsFormType>({
    resolver: zodResolver(databaseSettingsSchema),
    defaultValues: {
      localDatabaseEnabled: true,
      syncInterval: 15,
      offlineMode: false,
      syncOnStartup: true,
      maxOfflineDays: 7,
      compressionEnabled: true,
    },
  });
  
  // Update form with settings if available
  useEffect(() => {
    if (settings && settings.databaseSettings) {
      const dbSettings = settings.databaseSettings;
      form.reset({
        localDatabaseEnabled: dbSettings.localDatabaseEnabled ?? true,
        syncInterval: dbSettings.syncInterval ?? 15,
        offlineMode: dbSettings.offlineMode ?? false,
        syncOnStartup: dbSettings.syncOnStartup ?? true,
        maxOfflineDays: dbSettings.maxOfflineDays ?? 7,
        compressionEnabled: dbSettings.compressionEnabled ?? true,
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
        } else {
          setDbStatus('disconnected');
        }
      } catch (error) {
        console.error('Error checking database connection:', error);
        setDbStatus('disconnected');
      }
    } else {
      // If not in Electron, always show as disconnected
      setDbStatus('disconnected');
    }
  }, [isElectron, electronBridge, setDbStatus]);

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
            description: "Local database settings have been saved successfully.",
          });
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
  }, [isElectron, toast, settings, updateSettings]);

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Local Database Settings
            </CardTitle>
            <CardDescription>
              Configure offline database and synchronization settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Database status indicator */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <span className="font-medium">Local Database Status</span>
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
                  Local database functionality is only available in the desktop application.
                  These settings will have no effect in the web browser.
                </p>
              </div>
            )}

            <FormField
              control={form.control}
              name="localDatabaseEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable Local Database</FormLabel>
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
              name="syncInterval"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sync Interval (minutes)</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      {...field} 
                      disabled={!isElectron || !form.watch("localDatabaseEnabled")}
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
                      disabled={!isElectron || !form.watch("localDatabaseEnabled")}
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
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isElectron || !form.watch("localDatabaseEnabled")}
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
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!isElectron || !form.watch("localDatabaseEnabled")}
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
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!isElectron || !form.watch("localDatabaseEnabled")}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

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
            <Button 
              type="button" 
              variant="outline"
              onClick={checkDatabaseConnection}
              disabled={!isElectron}
            >
              Test Connection
            </Button>
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