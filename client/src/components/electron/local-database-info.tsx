import React, { useState, useEffect } from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { Loader2, Database, Save, RefreshCw, FileText, Check, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

/**
 * Component that displays local database information
 */
export const LocalDatabaseInfo: React.FC = () => {
  const { isElectron, bridge } = useElectron();
  const { toast } = useToast();
  const [dbInfo, setDbInfo] = useState<{
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
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  useEffect(() => {
    if (!isElectron || !bridge) return;

    const fetchDatabaseInfo = async () => {
      try {
        setIsLoading(true);
        const info = await bridge.getDatabaseInfo();
        setDbInfo(info);
      } catch (error) {
        console.error('Failed to fetch database info:', error);
        toast({
          title: 'Error',
          description: 'Failed to retrieve database information',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchDatabaseInfo();

    // Listen for database status updates
    const removeDatabaseStatusListener = bridge.on<typeof dbInfo>('database-status-changed', (info) => {
      setDbInfo(info);
    });

    // Listen for sync progress
    const removeSyncProgressListener = bridge.on('sync-progress', (progress: number) => {
      setSyncProgress(progress);
    });

    return () => {
      removeDatabaseStatusListener();
      removeSyncProgressListener();
    };
  }, [isElectron, bridge, toast]);

  const handleCreateBackup = async () => {
    if (!isElectron || !bridge) return;

    try {
      setIsBackingUp(true);
      const result = await bridge.createDatabaseBackup();
      if (result.success) {
        toast({
          title: 'Backup Created',
          description: `Backup saved to ${result.path}`,
          variant: 'default',
        });
        // Refresh database info to show updated last backup time
        const info = await bridge.getDatabaseInfo();
        setDbInfo(info);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Failed to create backup:', error);
      toast({
        title: 'Backup Failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleSync = async () => {
    if (!isElectron || !bridge) return;

    try {
      setIsSyncing(true);
      setSyncProgress(0);
      await bridge.syncDatabase();
      toast({
        title: 'Sync Complete',
        description: 'Database synchronized successfully',
        variant: 'default',
      });
      // Refresh database info
      const info = await bridge.getDatabaseInfo();
      setDbInfo(info);
    } catch (error) {
      console.error('Failed to sync database:', error);
      toast({
        title: 'Sync Failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
    }
  };

  if (!isElectron) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Local Database</CardTitle>
          <CardDescription>
            Only available in desktop application
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Local Database</CardTitle>
          <CardDescription>
            Loading database information...
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-6">
          <Loader2 className="h-8 w-8 animate-spin text-primary/70" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Database className="h-5 w-5 mr-2 text-primary" />
            <CardTitle>Local Database</CardTitle>
          </div>
          {dbInfo?.status && (
            <Badge 
              variant={
                dbInfo.status === 'healthy' 
                  ? 'default' 
                  : dbInfo.status === 'degraded' 
                    ? 'outline' 
                    : 'destructive'
              }
              className="ml-2"
            >
              {dbInfo.status === 'healthy' && <Check className="h-3 w-3 mr-1" />}
              {dbInfo.status === 'error' && <AlertTriangle className="h-3 w-3 mr-1" />}
              {dbInfo.status.charAt(0).toUpperCase() + dbInfo.status.slice(1)}
            </Badge>
          )}
        </div>
        <CardDescription>
          Manage your local database and synchronization
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {dbInfo && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Database Size</p>
                <p className="text-sm font-medium">{dbInfo.size || 'Unknown'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="text-sm font-medium overflow-hidden text-ellipsis">{dbInfo.location || 'Unknown'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Last Backup</p>
                <p className="text-sm font-medium">{dbInfo.lastBackup || 'Never'}</p>
              </div>
            </div>
            
            <div className="pt-2">
              <h4 className="text-sm font-semibold mb-2">Data Records</h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-background border rounded-md p-2 text-center">
                  <p className="text-xs text-muted-foreground">Inventory</p>
                  <p className="text-lg font-bold">{dbInfo.dataCount?.inventory || 0}</p>
                </div>
                <div className="bg-background border rounded-md p-2 text-center">
                  <p className="text-xs text-muted-foreground">Movements</p>
                  <p className="text-lg font-bold">{dbInfo.dataCount?.movements || 0}</p>
                </div>
                <div className="bg-background border rounded-md p-2 text-center">
                  <p className="text-xs text-muted-foreground">Suppliers</p>
                  <p className="text-lg font-bold">{dbInfo.dataCount?.suppliers || 0}</p>
                </div>
                <div className="bg-background border rounded-md p-2 text-center">
                  <p className="text-xs text-muted-foreground">Users</p>
                  <p className="text-lg font-bold">{dbInfo.dataCount?.users || 0}</p>
                </div>
              </div>
            </div>
            
            {isSyncing && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">Syncing data...</p>
                  <p className="text-xs font-medium">{syncProgress}%</p>
                </div>
                <Progress value={syncProgress} className="h-2" />
              </div>
            )}
          </>
        )}
      </CardContent>
      
      <CardFooter className="flex justify-between gap-2">
        <Button 
          variant="outline" 
          className="flex-1"
          onClick={handleCreateBackup}
          disabled={isBackingUp || isSyncing}
        >
          {isBackingUp ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Backing Up...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-1" />
              Create Backup
            </>
          )}
        </Button>
        <Button 
          variant="default" 
          className="flex-1"
          onClick={handleSync}
          disabled={isBackingUp || isSyncing}
        >
          {isSyncing ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-1" />
              Sync Database
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};