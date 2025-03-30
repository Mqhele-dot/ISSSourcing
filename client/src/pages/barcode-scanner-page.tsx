import React, { useState } from 'react';
import { BarcodeScanner, BarcodeGenerator } from '@/components/barcode';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScanResult } from '@/hooks/use-barcode-scanner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QrCode, Barcode, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { RealTimeUpdates } from '@/components/real-time-updates';

export default function BarcodeScannerPage() {
  const [tab, setTab] = useState('scan');
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const { toast } = useToast();
  
  const handleScan = (result: ScanResult) => {
    setScanHistory((prevHistory) => [result, ...prevHistory]);
    
    // In a real application, you would typically do something with the scan result,
    // such as looking up an inventory item or updating a database
    toast({
      title: 'Scan Processed',
      description: `Looking up item with code: ${result.text}`,
    });
    
    // Simulate API call - this would be replaced with actual API call
    // to look up item by barcode/QR code
    setTimeout(() => {
      // This is just for demonstration - in a real app, you would query the database
      // queryClient.invalidateQueries({ queryKey: ['/api/inventory/byBarcode', result.text] });
      
      toast({
        title: 'Item Found',
        description: `Found item matching code: ${result.text}`,
      });
    }, 1000);
  };
  
  const clearHistory = () => {
    setScanHistory([]);
  };
  
  return (
    <div className="container px-4 py-6 mx-auto max-w-7xl">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Barcode & QR Scanner</h1>
      
      {/* Main content area */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column - Barcode scanning and generation */}
        <div className="space-y-6 lg:col-span-2">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">
                <QrCode className="h-4 w-4 mr-2" />
                Scan Code
              </TabsTrigger>
              <TabsTrigger value="generate">
                <Barcode className="h-4 w-4 mr-2" />
                Generate Code
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="scan">
              <BarcodeScanner onScan={handleScan} />
            </TabsContent>
            
            <TabsContent value="generate">
              <BarcodeGenerator />
            </TabsContent>
          </Tabs>
          
          <Alert>
            <AlertTitle>How it works</AlertTitle>
            <AlertDescription>
              {tab === 'scan' ? (
                <p>This scanner works with both barcodes and QR codes. Position the code within the scanning area and hold steady. When detected, the code will be processed automatically.</p>
              ) : (
                <p>Enter a value to generate a barcode or QR code. You can download, print, or copy the generated code for use in your inventory system.</p>
              )}
            </AlertDescription>
          </Alert>
          
          {/* Scan history */}
          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span>Scan History</span>
                {scanHistory.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearHistory}>
                    Clear
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {scanHistory.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <QrCode className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No scans yet. Scan a barcode or QR code to see results here.</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-3">
                    {scanHistory.map((scan, index) => (
                      <Card key={index} className="p-3 border border-muted">
                        <div className="flex items-start gap-3">
                          <div className="rounded-full p-2 bg-primary/10 text-primary">
                            {scan.format.includes('QR') ? (
                              <QrCode className="h-4 w-4" />
                            ) : (
                              <Barcode className="h-4 w-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{scan.text}</p>
                            <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                              <span>{scan.format}</span>
                              <span>•</span>
                              <span>{new Date(scan.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Right column - Real-time inventory updates */}
        <div className="lg:col-span-1">
          {/* Real-time updates component */}
          <RealTimeUpdates />
        </div>
      </div>
    </div>
  );
}