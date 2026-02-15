import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { fetchDiagnosticsScan, fixDiagnostics } from "@/api/client";

// Define the tutorial step interface
interface TutorialStep {
  id: string;
  title: string;
  text: string;
  attachTo?: {
    element: string;
    on: string;
  };
}

interface TutorialContextType {
  startTutorial: (tourId?: string) => void;
  endTutorial: () => void;
  isTutorialActive: boolean;
  currentStep: number;
  registerTutorial: (tourId: string, steps: TutorialStep[]) => void;
  scanForErrors: () => Promise<{ [key: string]: string[] }>;
  fixErrors: (errorType: string) => Promise<{ success: boolean; message?: string }>;
  activeTourSteps: TutorialStep[] | null;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

interface TutorialProviderProps {
  children: ReactNode;
}

export function TutorialProvider({ children }: TutorialProviderProps) {
  const [isTutorialActive, setIsTutorialActive] = useState(false);
  const [activeTour, setActiveTour] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [tutorials, setTutorials] = useState<{ [key: string]: TutorialStep[] }>({});

  // Register a new tutorial with steps
  const registerTutorial = (tourId: string, steps: TutorialStep[]) => {
    setTutorials(prev => ({
      ...prev,
      [tourId]: steps
    }));
  };

  // Get the steps for the active tutorial
  const activeTourSteps = activeTour && tutorials[activeTour] ? tutorials[activeTour] : null;

  // Navigation functions
  const goToNextStep = () => {
    if (!activeTourSteps) return;
    
    if (currentStep < activeTourSteps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      // End the tutorial when we reach the last step
      endTutorial();
    }
  };

  const goToPreviousStep = () => {
    if (!activeTourSteps) return;
    
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  // Start a tutorial
  const startTutorial = (tourId = "main") => {
    if (!tutorials[tourId]) {
      console.error(`Tutorial with ID "${tourId}" not found.`);
      return;
    }

    setActiveTour(tourId);
    setCurrentStep(0);
    setIsTutorialActive(true);
  };

  // End the current tutorial
  const endTutorial = () => {
    setIsTutorialActive(false);
    setActiveTour(null);
    setCurrentStep(0);
  };

  // Scan for common errors (server + client checks)
  const scanForErrors = async (): Promise<{ [key: string]: string[] }> => {
    const result: { [key: string]: string[] } = {
      database: [],
      configuration: [],
      data: [],
      system: [],
    };
    try {
      const serverResult = await fetchDiagnosticsScan();
      result.database = serverResult.database ?? [];
      result.configuration = serverResult.configuration ?? [];
      result.data = serverResult.data ?? [];
      result.system = serverResult.system ?? [];
    } catch {
      result.database = ["Could not reach server to run diagnostics"];
    }
    // Client-only system checks (no camera prompt; use Permissions API when available)
    if (typeof navigator !== "undefined") {
      if (navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
          if (perm.state === "denied") {
            result.system.push("Camera access not granted");
          }
        } catch {
          result.system.push("Camera access not granted");
        }
      } else if (!navigator.mediaDevices?.getUserMedia) {
        result.system.push("Camera access not granted");
      }
    }
    try {
      const used = typeof localStorage !== "undefined" ? localStorage.length : 0;
      const quota = 5000;
      if (used > quota) {
        result.system.push("Local storage nearly full");
      }
    } catch {
      result.system.push("Local storage nearly full");
    }
    const filtered: { [key: string]: string[] } = {};
    for (const [key, arr] of Object.entries(result)) {
      if (Array.isArray(arr) && arr.length > 0) filtered[key] = arr;
    }
    return filtered;
  };

  // Attempt to fix errors via API (returns success and optional message for manual fixes)
  const fixErrors = async (errorType: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const fixResult = await fixDiagnostics(errorType);
      const success = fixResult.success;
      const message = fixResult.message ?? (success && fixResult.fixed?.length ? `Fixed: ${fixResult.fixed.length} item(s).` : undefined);
      return { success, message };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Fix failed.";
      return { success: false, message };
    }
  };

  // Provide context values to all children
  const contextValue = {
    startTutorial,
    endTutorial,
    isTutorialActive,
    currentStep,
    registerTutorial,
    scanForErrors,
    fixErrors,
    activeTourSteps,
    goToNextStep,
    goToPreviousStep
  };
  
  return (
    <TutorialContext.Provider value={contextValue}>
      {children}
      
      {/* Tutorial Dialog */}
      {isTutorialActive && activeTourSteps && (
        <Dialog open={isTutorialActive} onOpenChange={endTutorial}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{activeTourSteps[currentStep]?.title || "Tutorial"}</DialogTitle>
              <DialogDescription>
                {activeTourSteps[currentStep]?.text || "Follow these steps to learn about the application."}
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex justify-between items-center pt-4">
              <div className="text-sm text-muted-foreground">
                Step {currentStep + 1} of {activeTourSteps.length}
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToPreviousStep}
                  disabled={currentStep === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={goToNextStep}
                >
                  {currentStep === activeTourSteps.length - 1 ? "Finish" : "Next"}
                  {currentStep < activeTourSteps.length - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
                </Button>
              </div>
            </div>
            
            <DialogFooter className="pt-2">
              <Button variant="ghost" size="sm" onClick={endTutorial}>
                <X className="h-4 w-4 mr-1" />
                Skip Tutorial
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </TutorialContext.Provider>
  );
}

// Hook to use the tutorial context
export function useTutorial() {
  const context = useContext(TutorialContext);
  
  if (context === undefined) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  
  return context;
}