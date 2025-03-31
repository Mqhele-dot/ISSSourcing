import { Button } from "@/components/ui/button";
import { 
  AlertCircle, 
  HelpCircle, 
  Loader2, 
  BookOpen, 
  Home, 
  Package, 
  BarChart4, 
  Store, 
  Users, 
  Settings, 
  FileText, 
  ShoppingCart, 
  QrCode, 
  RefreshCw
} from "lucide-react";
import { useState } from "react";
import { useTutorial } from "@/contexts/tutorial-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

/**
 * A button component that provides access to the application tutorials and error scanning
 */
export function TutorialButton() {
  const { startTutorial, scanForErrors, fixErrors } = useTutorial();
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<{ [key: string]: string[] } | null>(null);
  const [isFixing, setIsFixing] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("tutorials");
  
  // Define all tutorials for each page
  const pageSpecificTutorials = [
    {
      id: "dashboard",
      name: "Dashboard",
      description: "Overview of your inventory status and key metrics",
      icon: <Home className="h-5 w-5 mr-2" />,
      color: "bg-blue-100"
    },
    {
      id: "inventory",
      name: "Inventory",
      description: "Manage products, stock levels, and item details",
      icon: <Package className="h-5 w-5 mr-2" />,
      color: "bg-green-100"
    },
    {
      id: "reports",
      name: "Reports",
      description: "Analytics and custom reporting features",
      icon: <BarChart4 className="h-5 w-5 mr-2" />,
      color: "bg-purple-100"
    },
    {
      id: "suppliers",
      name: "Suppliers",
      description: "Manage vendor information and contacts",
      icon: <Store className="h-5 w-5 mr-2" />,
      color: "bg-yellow-100"
    },
    {
      id: "users",
      name: "User Roles",
      description: "Manage user permissions and access control",
      icon: <Users className="h-5 w-5 mr-2" />,
      color: "bg-red-100"
    },
    {
      id: "settings",
      name: "Settings",
      description: "Configure application preferences",
      icon: <Settings className="h-5 w-5 mr-2" />,
      color: "bg-gray-100"
    },
    {
      id: "documents",
      name: "Document Generation",
      description: "Generate PDF, Excel, and CSV reports",
      icon: <FileText className="h-5 w-5 mr-2" />,
      color: "bg-indigo-100"
    },
    {
      id: "purchase",
      name: "Purchase Orders",
      description: "Manage purchase requisitions and orders",
      icon: <ShoppingCart className="h-5 w-5 mr-2" />,
      color: "bg-pink-100"
    },
    {
      id: "barcode",
      name: "Barcode Scanner",
      description: "Scan and generate barcodes for inventory",
      icon: <QrCode className="h-5 w-5 mr-2" />,
      color: "bg-cyan-100"
    },
    {
      id: "sync",
      name: "Real-time Sync",
      description: "Learn about real-time inventory synchronization",
      icon: <RefreshCw className="h-5 w-5 mr-2" />,
      color: "bg-amber-100"
    },
    {
      id: "billing",
      name: "Billing",
      description: "Manage invoices and payment processing",
      icon: <FileText className="h-5 w-5 mr-2" />,
      color: "bg-teal-100"
    }
  ];
  
  // Start a tutorial with the given ID
  const handleStartTutorial = (tourId: string) => {
    startTutorial(tourId);
    setShowDialog(false);
  };
  
  // Scan for errors in the system
  const handleScanForErrors = async () => {
    setIsScanning(true);
    setScanResults(null);
    setActiveTab("diagnostics");
    
    try {
      const results = await scanForErrors();
      setScanResults(results);
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
        
        // Reset if all errors are fixed
        if (Object.keys(updatedResults).length === 0) {
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
        onClick={() => {
          setShowDialog(true);
          setActiveTab("tutorials");
        }}
      >
        {isScanning ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <HelpCircle className="h-5 w-5" />
        )}
        <span className="sr-only">Help & Tutorials</span>
      </Button>
      
      {/* Tutorial & Diagnostics Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Help & Tutorials</DialogTitle>
            <DialogDescription>
              Get assistance with various features or run system diagnostics.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="tutorials" value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="tutorials">Tutorials</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            </TabsList>
            
            <TabsContent value="tutorials" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto p-1">
                {pageSpecificTutorials.map((tutorial) => (
                  <Card key={tutorial.id} className={`${tutorial.color} border-none hover:shadow-md transition-shadow cursor-pointer`} onClick={() => handleStartTutorial(tutorial.id)}>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm flex items-center">
                        {tutorial.icon}
                        {tutorial.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <CardDescription className="text-xs">
                        {tutorial.description}
                      </CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
              
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleStartTutorial("main")}
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Start Complete Tour
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="diagnostics" className="mt-4">
              <div className="mb-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleScanForErrors}
                  disabled={isScanning}
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Scanning System...
                    </>
                  ) : (
                    <>
                      <AlertCircle className="mr-2 h-4 w-4" />
                      Scan for Issues
                    </>
                  )}
                </Button>
              </div>
              
              <div className="space-y-4 max-h-[360px] overflow-y-auto">
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
                ) : scanResults ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p>All issues have been resolved! 🎉</p>
                  </div>
                ) : !isScanning ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p>Click "Scan for Issues" to check for problems</p>
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
          
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