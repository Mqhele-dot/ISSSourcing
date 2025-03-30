import React, { useEffect } from 'react';
import { useElectron } from '@/contexts/electron-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Download, Info, RefreshCw, AlertTriangle } from 'lucide-react';

/**
 * Component that displays update notifications for the desktop app
 * 
 * This component checks for updates and shows a dialog when an update
 * is available, allowing the user to download and install it.
 */
export function UpdateNotification() {
  const { isElectron, updateStatus, updateActions } = useElectron();
  
  useEffect(() => {
    // Check for updates when the component mounts
    if (isElectron && updateActions) {
      const checkInterval = setInterval(() => {
        updateActions.checkForUpdates();
      }, 60 * 60 * 1000); // Check once per hour
      
      updateActions.checkForUpdates();
      
      return () => clearInterval(checkInterval);
    }
  }, [isElectron, updateActions]);
  
  if (!isElectron || !updateActions) {
    return null;
  }

  // Only render something when there's an update available or error
  if (updateStatus.state === 'idle' || 
      updateStatus.state === 'checking' || 
      updateStatus.state === 'not-available') {
    return null;
  }
  
  if (updateStatus.state === 'error') {
    return (
      <Alert variant="destructive" className="fixed bottom-4 right-4 w-80 shadow-lg">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Update Error</AlertTitle>
        <AlertDescription>
          {updateStatus.error || 'An error occurred while checking for updates.'}
        </AlertDescription>
        <Button 
          variant="outline" 
          size="sm" 
          className="mt-2" 
          onClick={updateActions.checkForUpdates}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </Alert>
    );
  }

  if (updateStatus.state === 'available') {
    return (
      <Alert className="fixed bottom-4 right-4 w-80 shadow-lg border-primary">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle>Update Available</AlertTitle>
        <AlertDescription>
          Version {updateStatus.version} is available. Would you like to download it now?
          {updateStatus.releaseNotes && updateStatus.releaseNotes.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <strong>Release notes:</strong>
              <ul className="list-disc pl-4 mt-1">
                {updateStatus.releaseNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </AlertDescription>
        <Button 
          variant="default" 
          size="sm" 
          className="mt-2" 
          onClick={updateActions.downloadUpdate}
        >
          <Download className="mr-2 h-4 w-4" />
          Download Update
        </Button>
      </Alert>
    );
  }

  if (updateStatus.state === 'downloading') {
    return (
      <Alert className="fixed bottom-4 right-4 w-80 shadow-lg">
        <Info className="h-4 w-4" />
        <AlertTitle>Downloading Update</AlertTitle>
        <AlertDescription>
          {updateStatus.downloadProgress !== null ? (
            <div className="mt-2">
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary" 
                  style={{ width: `${updateStatus.downloadProgress}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground mt-1 text-right">
                {Math.round(updateStatus.downloadProgress)}%
              </div>
            </div>
          ) : (
            <div className="animate-pulse">Downloading...</div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (updateStatus.state === 'downloaded') {
    return (
      <Alert className="fixed bottom-4 right-4 w-80 shadow-lg border-primary">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle>Update Ready</AlertTitle>
        <AlertDescription>
          Update has been downloaded. Install now to get the latest features and improvements.
        </AlertDescription>
        <Button 
          variant="default" 
          size="sm" 
          className="mt-2" 
          onClick={updateActions.installUpdate}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Install and Restart
        </Button>
      </Alert>
    );
  }

  return null;
}