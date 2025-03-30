import React, { ReactNode } from 'react';
import { useElectron } from '@/contexts/electron-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DownloadCloud } from 'lucide-react';

/**
 * Component that displays when the application is not running in Electron
 */
export function ElectronRequired() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full">
        <Alert variant="destructive" className="mb-6 border-2">
          <DownloadCloud className="h-5 w-5 mr-2" />
          <AlertTitle>Desktop App Required</AlertTitle>
          <AlertDescription className="mt-2">
            This feature is only available in the desktop application.
          </AlertDescription>
        </Alert>
        
        <p className="text-sm text-muted-foreground mb-6">
          The InvTrack desktop app provides enhanced capabilities including:
        </p>
        
        <ul className="list-disc pl-6 mb-6 space-y-2 text-sm text-muted-foreground">
          <li>Offline functionality</li>
          <li>Local database access</li>
          <li>Barcode and QR code scanning</li>
          <li>Advanced document generation</li>
          <li>Automated data backup/restore</li>
          <li>Faster performance</li>
        </ul>
        
        <Button className="w-full" variant="default" size="lg" onClick={() => window.open('https://invtrack.app/download', '_blank')}>
          <DownloadCloud className="h-4 w-4 mr-2" />
          Download Desktop App
        </Button>
      </div>
    </div>
  );
}

/**
 * Wrapper component that only renders its children when in Electron environment
 */
export function ElectronOnly({ children }: { children: ReactNode }) {
  const { isElectron } = useElectron();
  
  if (!isElectron) {
    return <ElectronRequired />;
  }
  
  return <>{children}</>;
}