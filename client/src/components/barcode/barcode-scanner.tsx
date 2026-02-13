import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBarcodeScanner, ScannerType, ScanResult } from '@/hooks/use-barcode-scanner';
import { Loader2, QrCode, Barcode, Camera, X } from 'lucide-react';
import { isElectronEnvironment } from '@/lib/electron-bridge';

interface BarcodeScannerProps {
  onScan?: (result: ScanResult) => void;
  onClose?: () => void;
  defaultTab?: ScannerType;
}

export function BarcodeScanner({ 
  onScan, 
  onClose, 
  defaultTab = 'auto' 
}: BarcodeScannerProps) {
  const [tab, setTab] = useState<ScannerType>(defaultTab);
  const [scannerElementId] = useState(`scanner-${Math.random().toString(36).substring(2, 11)}`);
  const { isScanning, lastScan, error, startScanning, stopScanning } = useBarcodeScanner();

  // Handle scan result
  useEffect(() => {
    if (lastScan && onScan) {
      onScan(lastScan);
    }
  }, [lastScan, onScan]);

  // Stop scanner on unmount
  useEffect(() => {
    return () => {
      if (isScanning) {
        stopScanning();
      }
    };
  }, [isScanning, stopScanning]);

  // Handle tab change
  const handleTabChange = (value: string) => {
    if (isScanning) {
      stopScanning();
    }
    setTab(value as ScannerType);
  };

  // Start scanning with the selected type
  const handleStartScanning = async () => {
    await startScanning(scannerElementId, tab);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="text-lg font-semibold">Scan Barcode/QR Code</h3>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="auto">Auto Detect</TabsTrigger>
          <TabsTrigger value="barcode">Barcode</TabsTrigger>
          <TabsTrigger value="qrcode">QR Code</TabsTrigger>
        </TabsList>
        
        <TabsContent value="auto" className="space-y-4">
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Automatically detect and scan barcodes or QR codes.
            </p>
          </div>
        </TabsContent>
        
        <TabsContent value="barcode" className="space-y-4">
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Scan linear barcodes: UPC, EAN, Code 128, Code 39, etc.
            </p>
          </div>
        </TabsContent>
        
        <TabsContent value="qrcode" className="space-y-4">
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Scan QR codes only.
            </p>
          </div>
        </TabsContent>
      </Tabs>
      
      <CardContent className="p-4">
        {/* Scanner video container */}
        <div 
          id={scannerElementId} 
          className={`relative w-full aspect-square bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden flex items-center justify-center mb-4 ${isScanning ? '' : 'border-2 border-dashed border-gray-300 dark:border-gray-700'}`}
        >
          {!isScanning && !isElectronEnvironment() && (
            <div className="text-center p-4">
              <Camera className="h-12 w-12 mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-muted-foreground">
                Click 'Start Scanning' to activate camera
              </p>
            </div>
          )}
          
          {!isScanning && isElectronEnvironment() && (
            <div className="text-center p-4">
              {tab === 'qrcode' ? (
                <QrCode className="h-12 w-12 mx-auto mb-2 text-gray-400" />
              ) : (
                <Barcode className="h-12 w-12 mx-auto mb-2 text-gray-400" />
              )}
              <p className="text-sm text-muted-foreground">
                Click 'Start Scanning' to open the scanner
              </p>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 bg-destructive/10 flex items-center justify-center">
              <div className="text-center p-4">
                <p className="text-sm font-medium text-destructive">
                  {error.message}
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => stopScanning()}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
        
        {/* Last scan result */}
        {lastScan && (
          <div className="mb-4 p-3 bg-primary/10 rounded-md">
            <div className="flex items-start gap-2">
              <div className="shrink-0 mt-1">
                {lastScan.format.includes('QR') ? (
                  <QrCode className="h-4 w-4 text-primary" />
                ) : (
                  <Barcode className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{lastScan.format}</p>
                <p className="text-sm font-medium truncate">{lastScan.text}</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Action buttons */}
        <div className="flex justify-between gap-2">
          <Button 
            variant="outline" 
            className="flex-1" 
            onClick={() => stopScanning()}
            disabled={!isScanning}
          >
            Stop
          </Button>
          <Button 
            variant="default" 
            className="flex-1" 
            onClick={handleStartScanning}
            disabled={isScanning}
          >
            {isScanning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : 'Start Scanning'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}