import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { AlertCircle, HelpCircle, LucideHelpCircle, Search, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { useTutorial } from "@/contexts/tutorial-context";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

/**
 * A button component that provides access to the application tutorials and error scanning
 */
export function TutorialButton() {
  const { startTutorial, scanForErrors, fixErrors } = useTutorial();
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<{ [key: string]: string[] } | null>(null);
  const [isFixing, setIsFixing] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  
  // Start a tutorial with the given ID
  const handleStartTutorial = (tourId: string) => {
    startTutorial(tourId);
  };
  
  // Scan for errors in the system
  const handleScanForErrors = async () => {
    setIsScanning(true);
    setScanResults(null);
    
    try {
      const results = await scanForErrors();
      setScanResults(results);
      setShowDialog(true);
    } catch (error) {
      console.error("Error scanning for issues:", error);
    } finally {
      setIsScanning(false);
    }
  };
  
  // Attempt to fix errors of a specific type
  const handleFixErrors = async (errorType: string) => {
    setIsFixing(errorType);
    
    try {
      const success = await fixErrors(errorType);
      
      // Update results by removing fixed errors if successful
      if (success && scanResults) {
        const updatedResults = { ...scanResults };
        delete updatedResults[errorType];
        
        // Close dialog if all errors are fixed
        if (Object.keys(updatedResults).length === 0) {
          setShowDialog(false);
          setScanResults(null);
        } else {
          setScanResults(updatedResults);
        }
      }
    } catch (error) {
      console.error(`Error fixing ${errorType} issues:`, error);
    } finally {
      setIsFixing(null);
    }
  };
  
  return (
    <>
      <Button 
        variant="outline" 
        size="icon" 
        className="rounded-full w-9 h-9"
        onClick={() => setShowDialog(true)}
      >
        {isScanning ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <HelpCircle className="h-5 w-5" />
        )}
        <span className="sr-only">Help & Tutorials</span>
      </Button>
      
      {/* Error scan results dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>System Scan Results</DialogTitle>
            <DialogDescription>
              The following issues were detected in your system.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4 max-h-[400px] overflow-y-auto">
            {scanResults && Object.keys(scanResults).length > 0 ? (
              Object.entries(scanResults).map(([errorType, errors]) => (
                <div key={errorType} className="border rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-medium capitalize">{errorType} Issues</h3>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => handleFixErrors(errorType)}
                      disabled={isFixing === errorType}
                    >
                      {isFixing === errorType ? (
                        <>
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                          Fixing...
                        </>
                      ) : (
                        "Fix Issues"
                      )}
                    </Button>
                  </div>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {errors.map((error, index) => (
                      <li key={index} className="flex items-start">
                        <AlertCircle className="mr-2 h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <p>All issues have been resolved! 🎉</p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}