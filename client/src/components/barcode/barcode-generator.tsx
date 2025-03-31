import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { QrCode, Barcode, Printer, Download, Copy } from 'lucide-react';

// Import barcode generator libraries directly to ensure they're available
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

type BarcodeFormat = 'CODE128' | 'CODE39' | 'EAN13' | 'EAN8' | 'UPC' | 'ITF14';

interface BarcodeGeneratorProps {
  initialValue?: string;
  onClose?: () => void;
}

export function BarcodeGenerator({ initialValue = '', onClose }: BarcodeGeneratorProps) {
  const [tab, setTab] = useState('barcode');
  const [value, setValue] = useState(initialValue);
  const [format, setFormat] = useState<BarcodeFormat>('CODE128');
  const [size, setSize] = useState('medium');
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const qrcodeRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // No need to load libraries dynamically anymore since we're importing them directly

  // Generate barcode/QR code whenever value, format, or size changes
  useEffect(() => {
    if (!value) return;
    
    const generateCode = async () => {
      try {
        if (tab === 'barcode' && barcodeRef.current && JsBarcode) {
          JsBarcode(barcodeRef.current, value, {
            format,
            width: getWidthFromSize(size),
            height: getHeightFromSize(size),
            displayValue: true,
            fontOptions: 'bold',
            fontSize: getSizeFontFromSize(size),
            margin: 10,
          });
        } else if (tab === 'qrcode' && qrcodeRef.current && QRCode) {
          qrcodeRef.current.innerHTML = '';
          await QRCode.toCanvas(
            qrcodeRef.current.appendChild(document.createElement('canvas')),
            value,
            {
              width: getQRSizeFromSize(size),
              margin: 1,
              color: {
                dark: '#000000',
                light: '#ffffff',
              },
            }
          );
        }
      } catch (err) {
        console.error('Error generating code:', err);
        toast({
          title: 'Generation Error',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    };
    
    generateCode();
  }, [tab, value, format, size, toast]);

  // Helper functions for size conversions
  const getWidthFromSize = (size: string): number => {
    switch (size) {
      case 'small': return 1;
      case 'large': return 3;
      default: return 2;
    }
  };
  
  const getHeightFromSize = (size: string): number => {
    switch (size) {
      case 'small': return 30;
      case 'large': return 80;
      default: return 60;
    }
  };
  
  const getSizeFontFromSize = (size: string): number => {
    switch (size) {
      case 'small': return 12;
      case 'large': return 20;
      default: return 16;
    }
  };
  
  const getQRSizeFromSize = (size: string): number => {
    switch (size) {
      case 'small': return 128;
      case 'large': return 256;
      default: return 200;
    }
  };

  // Print the generated code
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: 'Print Error',
        description: 'Unable to open print window. Please check your browser settings.',
        variant: 'destructive',
      });
      return;
    }
    
    const codeElement = tab === 'barcode' 
      ? barcodeRef.current 
      : qrcodeRef.current?.querySelector('canvas');
    
    if (!codeElement) return;
    
    const dataUrl = codeElement.toDataURL('image/png');
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print ${tab === 'barcode' ? 'Barcode' : 'QR Code'}</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              padding: 20px;
              box-sizing: border-box;
            }
            img {
              max-width: 100%;
            }
            .value {
              margin-top: 10px;
              font-family: sans-serif;
              font-size: 14px;
            }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <img src="${dataUrl}" alt="${tab === 'barcode' ? 'Barcode' : 'QR Code'}" />
          <div class="value">${value}</div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
  };

  // Download the generated code as a PNG image
  const handleDownload = () => {
    const codeElement = tab === 'barcode' 
      ? barcodeRef.current 
      : qrcodeRef.current?.querySelector('canvas');
    
    if (!codeElement) return;
    
    const dataUrl = codeElement.toDataURL('image/png');
    const downloadLink = document.createElement('a');
    downloadLink.href = dataUrl;
    downloadLink.download = `${tab}-${value}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    
    toast({
      title: 'Download Complete',
      description: `${tab === 'barcode' ? 'Barcode' : 'QR Code'} has been downloaded.`,
    });
  };

  // Copy the generated code to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(
      () => {
        toast({
          title: 'Copied to Clipboard',
          description: `Value "${value}" has been copied to clipboard.`,
        });
      },
      (err) => {
        console.error('Error copying to clipboard:', err);
        toast({
          title: 'Copy Error',
          description: 'Failed to copy to clipboard.',
          variant: 'destructive',
        });
      }
    );
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <div className="p-4 border-b">
        <h3 className="text-lg font-semibold">
          Generate {tab === 'barcode' ? 'Barcode' : 'QR Code'}
        </h3>
      </div>
      
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="barcode">
            <Barcode className="h-4 w-4 mr-2" />
            Barcode
          </TabsTrigger>
          <TabsTrigger value="qrcode">
            <QrCode className="h-4 w-4 mr-2" />
            QR Code
          </TabsTrigger>
        </TabsList>
        
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="value">Value</Label>
              <Input
                id="value"
                placeholder="Enter barcode/QR code value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            
            {tab === 'barcode' && (
              <div className="space-y-2">
                <Label htmlFor="format">Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as BarcodeFormat)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CODE128">Code 128 (General)</SelectItem>
                    <SelectItem value="CODE39">Code 39 (Alphanumeric)</SelectItem>
                    <SelectItem value="EAN13">EAN-13 (Product)</SelectItem>
                    <SelectItem value="EAN8">EAN-8 (Product)</SelectItem>
                    <SelectItem value="UPC">UPC (Product)</SelectItem>
                    <SelectItem value="ITF14">ITF-14 (Shipping)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="size">Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="mt-6">
              <div className={`bg-white p-4 rounded-md flex items-center justify-center ${!value ? 'border-2 border-dashed' : ''}`}>
                {tab === 'barcode' ? (
                  <div className="w-full flex justify-center">
                    {value ? (
                      <canvas ref={barcodeRef} className="max-w-full" />
                    ) : (
                      <div className="text-center p-8">
                        <Barcode className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                        <p className="text-sm text-gray-500">Enter a value to generate barcode</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div ref={qrcodeRef} className="flex justify-center items-center min-h-[150px]">
                    {!value && (
                      <div className="text-center p-8">
                        <QrCode className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                        <p className="text-sm text-gray-500">Enter a value to generate QR code</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="flex justify-between p-4 pt-0">
          <Button variant="outline" onClick={handleCopy} disabled={!value}>
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={!value}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={!value}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </CardFooter>
      </Tabs>
    </Card>
  );
}