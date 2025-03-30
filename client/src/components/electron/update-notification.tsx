import React from 'react';
import { useElectron } from '@/contexts/electron-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDownCircle, RefreshCw } from 'lucide-react';

/**
 * Component that displays a notification when a new update is available for the Electron application
 */
export function UpdateNotification() {
  const { updateAvailable, updateDownloaded, updateInfo, installUpdate, checkForUpdates } = useElectron();
  
  if (!updateAvailable && !updateDownloaded) {
    return null;
  }
  
  return (
    <Card className="shadow-lg border-primary/20 overflow-hidden">
      <CardHeader className="bg-primary/5 pb-4">
        <CardTitle className="flex items-center text-lg font-semibold">
          {updateDownloaded ? (
            <>
              <RefreshCw className="h-5 w-5 mr-2 text-primary" />
              Update Ready to Install
            </>
          ) : (
            <>
              <ArrowDownCircle className="h-5 w-5 mr-2 text-primary" />
              Update Available
            </>
          )}
        </CardTitle>
        <CardDescription>
          {updateInfo?.version && `Version ${updateInfo.version}`}
          {updateInfo?.releaseDate && ` - Released on ${new Date(updateInfo.releaseDate).toLocaleDateString()}`}
        </CardDescription>
      </CardHeader>
      
      {updateInfo?.releaseNotes && (
        <CardContent className="pt-4 max-h-40 overflow-y-auto">
          <div className="text-sm">
            <h4 className="font-medium mb-2">What's New:</h4>
            <div 
              className="prose prose-sm prose-neutral dark:prose-invert" 
              dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
            />
          </div>
        </CardContent>
      )}
      
      <CardFooter className={`flex ${updateDownloaded ? 'justify-between' : 'justify-end'} bg-background pt-4`}>
        {updateDownloaded ? (
          <>
            <Button variant="outline" size="sm" onClick={checkForUpdates}>
              Check Again
            </Button>
            <Button onClick={installUpdate} size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Restart & Install
            </Button>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            Update is downloading...
          </div>
        )}
      </CardFooter>
    </Card>
  );
}