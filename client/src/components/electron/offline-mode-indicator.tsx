import React, { useState, useEffect } from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Component that displays when the application is in offline mode
 */
export const OfflineModeIndicator: React.FC = () => {
  const { isElectron, bridge } = useElectron();
  const [isOffline, setIsOffline] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  useEffect(() => {
    if (!isElectron || !bridge) return;

    const checkNetworkStatus = async () => {
      try {
        setConnectionStatus('checking');
        const status = await bridge.checkNetworkStatus();
        setConnectionStatus(status ? 'online' : 'offline');
        setIsOffline(!status);
      } catch (error) {
        console.error('Failed to check network status:', error);
        setConnectionStatus('offline');
        setIsOffline(true);
      }
    };

    // Initial check
    checkNetworkStatus();

    // Setup interval for checking network status
    const interval = setInterval(checkNetworkStatus, 30000); // Check every 30 seconds

    // Setup online/offline event listeners as a backup
    const handleOnline = () => {
      setConnectionStatus('online');
      setIsOffline(false);
    };

    const handleOffline = () => {
      setConnectionStatus('offline');
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set up listener for IPC events related to network status
    const removeNetworkListener = bridge.on('network-status-changed', (status: boolean) => {
      setConnectionStatus(status ? 'online' : 'offline');
      setIsOffline(!status);
    });

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      removeNetworkListener();
    };
  }, [isElectron, bridge]);

  if (!isElectron || !isOffline) {
    return null;
  }

  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 mb-4 mx-4 mt-2">
      <WifiOff className="h-4 w-4 text-amber-500" />
      <AlertDescription className="text-sm text-amber-700">
        You are currently working offline. Changes will be synchronized when you reconnect.
      </AlertDescription>
    </Alert>
  );
};