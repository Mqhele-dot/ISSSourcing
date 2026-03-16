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
import { useLocation } from "wouter";
import { useTutorial } from "@/contexts/tutorial-context";
import { useHelpExplain } from "@/contexts/help-explain-context";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
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
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * A button component that provides access to the application tutorials and error scanning
 */
export function TutorialButton() {
  const [, setLocation] = useLocation();
  const { startTutorial, scanForErrors, fixErrors } = useTutorial();
  const { setExplainMode } = useHelpExplain();
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<{ [key: string]: string[] } | null>(null);
  const [isFixing, setIsFixing] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("tutorials");
  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers", "tutorial-assistant"],
    queryFn: () => requestJson<Array<{ id: number }>>("GET", "/api/suppliers"),
  });
  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory", "tutorial-assistant"],
    queryFn: async () => {
      const data = await requestJson<Array<{ id: number }> | { data: Array<{ id: number }> }>("GET", "/api/inventory");
      return Array.isArray(data) ? data : data?.data ?? [];
    },
  });
  
  // Define all tutorials for each page
  const pageSpecificTutorials = [
    {
      id: "setup-wizard",
      name: "Setup Wizard",
      description: "Guided first-time setup for warehouse, inventory, suppliers, and first PO",
      icon: <BookOpen className="h-5 w-5 mr-2" />,
      color: "bg-emerald-100"
    },
    {
      id: "database",
      name: "Database Setup",
      description: "Configure and manage your PostgreSQL database",
      icon: <AlertCircle className="h-5 w-5 mr-2" />,
      color: "bg-blue-200"
    },
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
      id: "analytics",
      name: "Analytics",
      description: "Inventory value, demand trends, and custom charts",
      icon: <BarChart4 className="h-5 w-5 mr-2" />,
      color: "bg-violet-100"
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
  
  // Start a tutorial with the given ID - navigate to relevant page first when needed
  const handleStartTutorial = (tourId: string) => {
    setShowDialog(false);
    const routeMap: Record<string, string> = {
      main: "/dashboard",
      dashboard: "/dashboard",
      inventory: "/inventory",
      reports: "/reports",
      analytics: "/analytics",
      suppliers: "/suppliers",
      users: "/user-roles",
      settings: "/settings",
      database: "/settings",
      documents: "/reports",
      purchase: "/purchase",
      barcode: "/barcode-scanner",
      sync: "/sync-dashboard",
      billing: "/billing",
      "setup-wizard": "/dashboard",
    };
    const targetRoute = routeMap[tourId] || (tourId === "main" ? "/dashboard" : undefined);
    const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
    const needsNavigation = targetRoute && !currentPath.startsWith(targetRoute);

    const tryStart = (retryCount = 0) => {
      const started = startTutorial(tourId);
      if (started) {
        toast({
          title: "Tutorial started",
          description: "Use Next / Previous to move through the steps, or Skip to close.",
        });
      } else if (retryCount < 1) {
        // Registration might be delayed; retry once after a short delay
        setTimeout(() => tryStart(retryCount + 1), 800);
      } else {
        toast({
          title: "Tutorial not available",
          description: `Tour "${tourId}" could not be loaded. Open the Dashboard or Analytics page first, then try again.`,
          variant: "destructive",
        });
      }
    };

    // When navigating, wait for the target page to mount so targetSelector elements (e.g. #dashboard-stats) exist
    if (needsNavigation && targetRoute) {
      setLocation(targetRoute);
      setTimeout(() => tryStart(0), 2200);
    } else {
      tryStart(0);
    }
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
      const { success, message } = await fixErrors(errorType);
      if (message) {
        toast({
          title: success ? "Fix applied" : "Could not auto-fix",
          description: message,
          variant: success ? "default" : "destructive",
        });
      }
      if (success && scanResults) {
        const updatedResults = { ...scanResults };
        delete updatedResults[errorType];
        if (Object.keys(updatedResults).length === 0) {
          setScanResults(null);
        } else {
          setScanResults(updatedResults);
        }
      }
    } catch (error) {
      console.error(`Error fixing ${errorType} issues:`, error);
      toast({
        title: "Fix failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
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
        data-help-title="Help & Tutorials"
        data-help-description="Open this menu to start a tutorial, turn on Explain mode (hover any control to see what it does), or run diagnostics."
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
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="tutorials">Tutorials</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="learning">Learning Center</TabsTrigger>
            </TabsList>
            
            <TabsContent value="tutorials" className="mt-4 space-y-4">
              {(suppliers.length === 0 || inventoryItems.length === 0) && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Recommended next step</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-3">
                    <span>
                      {suppliers.length === 0
                        ? "No suppliers found yet. Use Setup Wizard to create your initial vendor base."
                        : "No inventory items found yet. Use Setup Wizard to create your first SKUs."}
                    </span>
                    <Button size="sm" onClick={() => handleStartTutorial("setup-wizard")}>
                      Start Wizard
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
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
              
              <div className="flex flex-col gap-2">
                <Button
                  variant="default"
                  className="w-full"
                  onClick={() => {
                    setExplainMode(true);
                    setShowDialog(false);
                  }}
                >
                  <HelpCircle className="h-4 w-4 mr-2" />
                  What's this? — Explain buttons
                </Button>
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

            <TabsContent value="learning" className="mt-4 space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Getting Started</CardTitle>
                  <CardDescription>Fast onboarding for first-time teams.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" onClick={() => handleStartTutorial("setup-wizard")}>
                    Launch Setup Wizard
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => handleStartTutorial("main")}>
                    Platform Orientation Tour
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Role Learning Paths</CardTitle>
                  <CardDescription>Targeted tutorials by function.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" className="justify-start" onClick={() => handleStartTutorial("inventory")}>Inventory</Button>
                  <Button variant="ghost" className="justify-start" onClick={() => handleStartTutorial("purchase")}>Procurement</Button>
                  <Button variant="ghost" className="justify-start" onClick={() => handleStartTutorial("suppliers")}>Suppliers</Button>
                  <Button variant="ghost" className="justify-start" onClick={() => handleStartTutorial("reports")}>Reports</Button>
                  <Button variant="ghost" className="justify-start" onClick={() => handleStartTutorial("analytics")}>Analytics</Button>
                  <Button variant="ghost" className="justify-start" onClick={() => handleStartTutorial("users")}>Roles & Permissions</Button>
                </CardContent>
              </Card>
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