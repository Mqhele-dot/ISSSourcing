import { useState, useEffect, useRef, useCallback } from 'react';
import type { ScanResult as ElectronScanResult } from '@/lib/electron-bridge';
import { isElectronEnvironment } from '@/lib/electron-bridge';
import { useToast } from '@/hooks/use-toast';

export type ScannerType = 'barcode' | 'qrcode' | 'auto';
export type ScanResult = ElectronScanResult;
export type ScannerStatus = 'idle' | 'requesting' | 'denied' | 'unavailable' | 'active' | 'error';

// Define QrDimensions and QrDimensionFunction types for use in the component
interface QrDimensions {
  width: number;
  height: number;
}

type QrDimensionFunction = (viewfinderWidth: number, viewfinderHeight: number) => QrDimensions;

interface UseBarcodeScanner {
  isScanning: boolean;
  status: ScannerStatus;
  lastScan: ScanResult | null;
  error: Error | null;
  startScanning: (elementId: string, type?: ScannerType) => Promise<void>;
  stopScanning: () => void;
}

// Declare missing constants for the HTML5QRCode library (do not augment CameraScanConfig to avoid fps modifier conflict)
declare module 'html5-qrcode' {
  interface Html5QrcodeStatic {
    QRCODE: string;
    EAN_8: string;
    EAN_13: string;
    UPC_A: string;
    UPC_E: string;
    CODE_39: string;
    CODE_93: string;
    CODE_128: string;
    ITF: string;
    RSS_14: string;
  }
}

export function useBarcodeScanner(): UseBarcodeScanner {
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const scannerRef = useRef<any>(null);
  const { toast } = useToast();

  // Clean up scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        stopScanning();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start scanning for barcodes/QR codes
  const startScanning = useCallback(async (elementId: string, type: ScannerType = 'auto') => {
    try {
      setError(null);
      setStatus('requesting');
      
      // In Electron environment, use the Electron-specific scanner via IPC
      if (isElectronEnvironment()) {
        if (!window.electron) {
          throw new Error('Electron environment detected but bridge not available');
        }

        // Set up event listener for scan results from the main process
        const removeListener = window.electron.on('barcode-scan-result', (result: ScanResult) => {
          setLastScan(result);
          toast({
            title: `${result.format} Scanned`,
            description: result.text,
          });
        });

        // Start the native scanner
        await window.electron.invoke('start-barcode-scanner', { type });
        setIsScanning(true);
        setStatus('active');
        
        // Store the listener removal function in the ref for cleanup
        scannerRef.current = { type: 'electron', cleanup: removeListener };
      } 
      // In web environment, use HTML5-QRCode library
      else {
        const element = document.getElementById(elementId);
        if (!element) {
          throw new Error(`Element with ID "${elementId}" not found`);
        }

        try {
          // Request camera permission explicitly first
          if (!navigator.mediaDevices?.getUserMedia) {
            setStatus('unavailable');
            throw new Error('No camera is available in this browser or device.');
          }
          const permissionStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            } 
          });
          permissionStream.getTracks().forEach((track) => track.stop());
          
          // Dynamically import to avoid issues with SSR
          const { Html5Qrcode } = await import('html5-qrcode');
          
          // Create scanner instance
          const html5QrCode = new Html5Qrcode(elementId);
          
          // Hard-code format values because the library doesn't export them properly in TypeScript
          const FORMAT_VALUES = {
            QRCODE: 'QR_CODE',
            EAN_8: 'EAN_8',
            EAN_13: 'EAN_13',
            UPC_A: 'UPC_A',
            UPC_E: 'UPC_E',
            CODE_39: 'CODE_39',
            CODE_93: 'CODE_93',
            CODE_128: 'CODE_128',
            ITF: 'ITF',
            RSS_14: 'RSS_14'
          };
          
          // Determine which formats to scan based on the type
          const formatsToScan = type === 'qrcode' 
            ? [FORMAT_VALUES.QRCODE]
            : type === 'barcode'
              ? [
                  FORMAT_VALUES.EAN_8,
                  FORMAT_VALUES.EAN_13,
                  FORMAT_VALUES.UPC_A,
                  FORMAT_VALUES.UPC_E,
                  FORMAT_VALUES.CODE_39,
                  FORMAT_VALUES.CODE_93,
                  FORMAT_VALUES.CODE_128,
                  FORMAT_VALUES.ITF,
                  FORMAT_VALUES.RSS_14,
                ]
              : undefined; // 'auto' = all formats
              
          // Start scanning
          await html5QrCode.start(
            { facingMode: "environment" }, // Prefer rear camera
            {
              fps: 10,
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0,
              disableFlip: false,
              // @ts-ignore - Despite TypeScript errors, the library does accept this parameter
              formatsToSupport: formatsToScan,
            } as any,
            (decodedText, decodedResult) => {
              // Handle scan success
              const format = typeof decodedResult.result.format?.format === 'string' 
                ? decodedResult.result.format.format 
                : 'Unknown';
                
              const scanResult: ScanResult = {
                text: decodedText,
                format,
                timestamp: Date.now()
              };
              setLastScan(scanResult);
              toast({
                title: `${scanResult.format} Scanned`,
                description: scanResult.text,
              });
            },
            (errorMessage) => {
              // Errors during scanning don't need to be displayed to the user
              // unless they're fatal to the scanning process
              if (errorMessage.includes('not found') || 
                  errorMessage.includes('error') ||
                  errorMessage.includes('failed')) {
                console.error('Scanner error:', errorMessage);
              }
            }
          );
          
          // Store the scanner instance in the ref for cleanup
          scannerRef.current = { type: 'web', scanner: html5QrCode };
          setIsScanning(true);
          setStatus('active');
        } catch (cameraErr: unknown) {
          const cameraError = cameraErr instanceof Error ? cameraErr : new Error(String(cameraErr));
          if (cameraError.name === 'NotAllowedError' || /denied|permission/i.test(cameraError.message)) {
            setStatus('denied');
            throw new Error('Camera permission was denied. Allow camera access in browser settings, then retry.');
          }
          if (cameraError.name === 'NotFoundError' || /no camera|not found|unavailable/i.test(cameraError.message)) {
            setStatus('unavailable');
            throw new Error('No usable camera was found on this device.');
          }
          setStatus('error');
          throw cameraError;
        }
      }
    } catch (err) {
      console.error('Error starting scanner:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus((current) => current === 'denied' || current === 'unavailable' ? current : 'error');
      toast({
        title: 'Scanner Error',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive'
      });
    }
   
  }, [toast]);

  // Stop scanning
  const stopScanning = useCallback(() => {
    if (!scannerRef.current) return;
    
    try {
      if (scannerRef.current.type === 'electron') {
        // Stop the native scanner
        if (window.electron) {
          window.electron.invoke('stop-barcode-scanner');
        }
        // Remove event listener
        scannerRef.current.cleanup();
      } else if (scannerRef.current.type === 'web') {
        // Stop the web scanner
        scannerRef.current.scanner.stop();
      }
    } catch (err) {
      console.error('Error stopping scanner:', err);
    } finally {
      scannerRef.current = null;
      setIsScanning(false);
      setStatus('idle');
    }
   
  }, []);

  return {
    isScanning,
    status,
    lastScan,
    error,
    startScanning,
    stopScanning
  };
}
