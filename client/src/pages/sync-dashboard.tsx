import React from 'react';
import { RealTimeSyncStatus } from '@/components/sync/real-time-sync-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isElectronEnvironment, ElectronBridge } from '@/lib/electron-bridge';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Database, Download, HardDrive, Info, Server, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DatabaseInfo {
  status: 'healthy' | 'degraded' | 'error' | 'unknown';
  size: string;
  location: string;
  lastBackup: string | null;
  dataCount: {
    inventory: number;
    movements: number;
    suppliers: number;
    users: number;
  };
}

export default function SyncDashboard() {
  const [activeTab, setActiveTab] = React.useState('overview');
  const { toast } = useToast();
  
  // Query database info (only in Electron environment)
  const { data: dbInfo, isLoading: dbInfoLoading, refetch: refetchDbInfo } = useQuery<DatabaseInfo>({
    queryKey: ['databaseInfo'],
    queryFn: async () => {
      if (!isElectronEnvironment()) {
        return null;
      }
      const electronBridge = new ElectronBridge();
      return await electronBridge.getDatabaseInfo();
    },
    enabled: isElectronEnvironment(), // Only run in Electron environment
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  
  // Create backup mutation
  const createBackupMutation = useMutation({
    mutationFn: async () => {
      if (!isElectronEnvironment()) {
        throw new Error('Not running in Electron environment');
      }
      
      const electronBridge = new ElectronBridge();
      return await electronBridge.createDatabaseBackup();
    },
    onSuccess: (result) => {
      if (result.success) {
        toast({
          title: 'Backup Created',
          description: `Database backup created at ${result.path}`,
        });
        refetchDbInfo();
      } else {
        toast({
          title: 'Backup Failed',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Backup Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  });
  
  // Sync database mutation
  const syncDatabaseMutation = useMutation({
    mutationFn: async () => {
      if (!isElectronEnvironment()) {
        throw new Error('Not running in Electron environment');
      }
      
      const electronBridge = new ElectronBridge();
      return await electronBridge.syncDatabase();
    },
    onSuccess: () => {
      toast({
        title: 'Database Synced',
        description: 'The database has been synchronized with the server.',
      });
      refetchDbInfo();
    },
    onError: (error) => {
      toast({
        title: 'Sync Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  });
  
  // Handle create backup
  const handleCreateBackup = () => {
    createBackupMutation.mutate();
  };
  
  // Handle sync database
  const handleSyncDatabase = () => {
    syncDatabaseMutation.mutate();
  };
  
  // Format database status for display
  const getStatusBadgeProps = (status: string) => {
    switch (status) {
      case 'healthy':
        return { variant: 'default' as const, className: 'bg-green-500' };
      case 'degraded':
        return { variant: 'default' as const, className: 'bg-yellow-500' };
      case 'error':
        return { variant: 'destructive' as const };
      default:
        return { variant: 'outline' as const };
    }
  };
  
  return (
    <div className="container px-4 py-6 mx-auto max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Sync Dashboard</h1>
        <Badge variant="outline" className="flex items-center gap-1">
          {isElectronEnvironment() ? 'Desktop App' : 'Web Browser'}
        </Badge>
      </div>
      
      {!isElectronEnvironment() && (
        <Alert className="mb-6">
          <Info className="h-4 w-4" />
          <AlertTitle>Web Browser Mode</AlertTitle>
          <AlertDescription>
            Some synchronization features are only available in the desktop application.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left side - sync status */}
        <div className="lg:col-span-2 space-y-6">
          {/* Real-time sync component */}
          <RealTimeSyncStatus />
          
          {/* Supplementary sync options - only in Electron mode */}
          {isElectronEnvironment() && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  Database Operations
                </CardTitle>
                <CardDescription>
                  Manage local database backup and synchronization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Button 
                    onClick={handleCreateBackup}
                    disabled={createBackupMutation.isPending}
                    className="flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    {createBackupMutation.isPending ? 'Creating Backup...' : 'Create Backup'}
                  </Button>
                  
                  <Button 
                    onClick={handleSyncDatabase}
                    disabled={syncDatabaseMutation.isPending}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    {syncDatabaseMutation.isPending ? 'Syncing...' : 'Force Sync Database'}
                  </Button>
                </div>
                
                {dbInfo && (
                  <div className="bg-muted p-3 rounded-md mt-4">
                    <div className="text-sm font-medium mb-2">Database Information</div>
                    <div className="text-sm space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status:</span>
                        <Badge {...getStatusBadgeProps(dbInfo.status)}>
                          {dbInfo.status.charAt(0).toUpperCase() + dbInfo.status.slice(1)}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size:</span>
                        <span>{dbInfo.size}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Backup:</span>
                        <span>{dbInfo.lastBackup || 'Never'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
        
        {/* Right side - info panel */}
        <div className="space-y-6">
          {/* Database stats card - only in Electron mode */}
          {isElectronEnvironment() && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-primary" />
                  Local Database
                </CardTitle>
                <CardDescription>
                  Statistics about your local database
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                {dbInfoLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading database information...
                  </div>
                ) : dbInfo ? (
                  <Tabs defaultValue="stats" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="stats">Statistics</TabsTrigger>
                      <TabsTrigger value="info">Details</TabsTrigger>
                    </TabsList>
                    <TabsContent value="stats" className="mt-4">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-primary-foreground p-3 rounded-md text-center">
                            <div className="text-2xl font-bold">{dbInfo.dataCount.inventory}</div>
                            <div className="text-xs text-muted-foreground">Inventory Items</div>
                          </div>
                          <div className="bg-primary-foreground p-3 rounded-md text-center">
                            <div className="text-2xl font-bold">{dbInfo.dataCount.suppliers}</div>
                            <div className="text-xs text-muted-foreground">Suppliers</div>
                          </div>
                          <div className="bg-primary-foreground p-3 rounded-md text-center">
                            <div className="text-2xl font-bold">{dbInfo.dataCount.movements}</div>
                            <div className="text-xs text-muted-foreground">Stock Movements</div>
                          </div>
                          <div className="bg-primary-foreground p-3 rounded-md text-center">
                            <div className="text-2xl font-bold">{dbInfo.dataCount.users}</div>
                            <div className="text-xs text-muted-foreground">Users</div>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="info" className="mt-4">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="text-sm font-medium">Database Location</div>
                          <code className="text-xs break-all block p-2 rounded bg-muted">
                            {dbInfo.location}
                          </code>
                        </div>
                        
                        <Separator />
                        
                        <Button 
                          onClick={() => refetchDbInfo()} 
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                        >
                          Refresh Database Info
                        </Button>
                      </div>
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No database information available
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {/* Sync guide card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                Sync Guide
              </CardTitle>
              <CardDescription>
                How to use the synchronization features
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <h3 className="font-medium">Real-Time Sync</h3>
                <p className="text-muted-foreground mt-1">
                  Real-time sync keeps your inventory data up-to-date across all devices.
                  Changes made on one device are immediately reflected on others.
                </p>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="font-medium">Offline Mode</h3>
                <p className="text-muted-foreground mt-1">
                  When you're offline, changes are stored locally and will 
                  automatically sync when you reconnect to the internet.
                </p>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="font-medium">Manual Sync</h3>
                <p className="text-muted-foreground mt-1">
                  Use the "Sync Now" button to manually synchronize data 
                  if you suspect any inconsistency between devices.
                </p>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="font-medium">Backup</h3>
                <p className="text-muted-foreground mt-1">
                  {isElectronEnvironment() 
                    ? 'Regularly create backups of your local database to prevent data loss.'
                    : 'Backups are available in the desktop application.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}