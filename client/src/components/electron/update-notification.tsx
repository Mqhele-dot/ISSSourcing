import React, { useState, useEffect } from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { AlertCircle, Download, X } from 'lucide-react';
import { 
  Alert,
  AlertDescription,
  AlertTitle 
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export const UpdateNotification: React.FC = () => {
  const { isElectron, electron } = useElectron();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes: string } | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isElectron || !electron) return;

    // Listen for update notifications from the main process
    const removeListener = electron.on('update-available', (info: any) => {
      setUpdateAvailable(true);
      setUpdateInfo({
        version: info.version || 'New Version',
        notes: info.releaseNotes || 'Bug fixes and improvements'
      });
    });

    // Listen for update progress events
    electron.on('update-progress', (progress: number) => {
      // Could implement a progress bar here
      console.log(`Update progress: ${progress}%`);
    });

    // Listen for update downloaded event
    electron.on('update-downloaded', () => {
      setIsInstalling(false);
    });

    // Check for updates when component mounts
    electron.invoke('check-for-updates').catch(console.error);

    return () => {
      // Cleanup listeners on unmount
      removeListener();
    };
  }, [isElectron, electron]);

  const handleInstallUpdate = () => {
    if (!isElectron || !electron) return;
    
    setIsInstalling(true);
    electron.invoke('install-update').catch((error: unknown) => {
      console.error('Failed to install update:', error);
      setIsInstalling(false);
    });
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (!isElectron || !updateAvailable || dismissed) {
    return null;
  }

  return (
    <Alert className="fixed top-16 right-4 w-80 shadow-lg z-50 border-primary/20 bg-background">
      <AlertCircle className="h-4 w-4 text-primary" />
      <div className="flex-1">
        <AlertTitle className="text-sm font-medium">
          Update Available: {updateInfo?.version}
        </AlertTitle>
        <AlertDescription className="text-xs mt-1">
          {updateInfo?.notes}
        </AlertDescription>
        <div className="flex items-center justify-between mt-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="h-8 text-xs" 
            onClick={handleInstallUpdate}
            disabled={isInstalling}
          >
            {isInstalling ? 'Installing...' : 'Install Now'}
            {!isInstalling && <Download className="ml-1 h-3 w-3" />}
          </Button>
          <Button 
            size="sm" 
            variant="ghost" 
            className="h-8 text-xs" 
            onClick={handleDismiss}
          >
            Later <X className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </div>
    </Alert>
  );
};