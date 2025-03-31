import React, { useState } from 'react';
import { Container } from '@/components/ui/container';
import { RealTimeSyncStatus } from '@/components/sync/real-time-sync-status';
import { RealTimeSyncTester } from '@/components/sync/real-time-sync-tester';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InfoCircledIcon, GearIcon, CircleBackslashIcon } from '@radix-ui/react-icons';
import { FlaskConical } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { isElectronEnvironment, callElectronBridge } from '@/lib/electron-bridge';

export default function SyncTestPage() {
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const handleClearLocalDb = async () => {
    if (!isElectronEnvironment()) {
      alert('This operation can only be performed in the desktop application');
      return;
    }

    const confirmation = confirm(
      'Are you sure you want to clear the local database? This will delete all local data. ' +
      'You should sync with the server after this operation to restore your data.'
    );

    if (!confirmation) return;

    try {
      await callElectronBridge('db', 'clearDatabase');
      alert('Local database cleared successfully. You may need to restart the application or perform a sync to restore data.');
    } catch (error) {
      const errorMessage = (error as Error)?.message || 'Unknown error';
      setLastError(errorMessage);
      alert(`Failed to clear database: ${errorMessage}`);
    }
  };

  return (
    <Container className="py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Real-Time Sync Testing</h1>
        <p className="text-muted-foreground mt-2">
          Test and monitor the real-time synchronization between the server and client
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <InfoCircledIcon className="h-5 w-5" />
                Connection Status
              </CardTitle>
              <CardDescription>
                Current connection and synchronization status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RealTimeSyncStatus showDebugInfo={showDebugInfo} />
              
              <div className="mt-6 flex items-center space-x-2">
                <Switch
                  id="debug-mode"
                  checked={showDebugInfo}
                  onCheckedChange={setShowDebugInfo}
                />
                <Label htmlFor="debug-mode">Show debug information</Label>
              </div>

              {isElectronEnvironment() && (
                <div className="mt-6 pt-4 border-t">
                  <h3 className="text-sm font-medium mb-3">Desktop Application Options</h3>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    className="w-full"
                    onClick={handleClearLocalDb}
                  >
                    <CircleBackslashIcon className="mr-2 h-4 w-4" />
                    Clear Local Database
                  </Button>
                  {lastError && (
                    <p className="text-destructive text-xs mt-2">{lastError}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Sync Test Tools
              </CardTitle>
              <CardDescription>
                Tools for testing and debugging real-time synchronization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RealTimeSyncTester />
            </CardContent>
          </Card>
        </div>
      </div>
    </Container>
  );
}