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
  fixErrors: (errorType: string) => Promise<boolean>;
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

  // Scan for common errors in the application
  const scanForErrors = async (): Promise<{ [key: string]: string[] }> => {
    // This would normally make API calls to check for various system issues
    // For now, we'll simulate a scan with some sample error types
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate a delay
    
    // Return object with error types and specific errors
    return {
      "database": ["Corrupted settings schema", "Missing index on inventory table"],
      "configuration": ["Stripe API key not set", "Email configuration incomplete"],
      "data": ["2 duplicate SKUs found", "3 items with negative stock"],
      "system": ["Camera access not granted", "Local storage nearly full"]
    };
  };

  // Attempt to fix errors automatically
  const fixErrors = async (errorType: string): Promise<boolean> => {
    // This would normally make API calls to fix specific issues
    // For now, we'll simulate the fix process
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate a delay
    
    // Return success based on error type
    // In a real implementation, this would call actual API endpoints to fix issues
    switch(errorType) {
      case "database":
        return Math.random() > 0.3; // 70% success rate
      case "configuration":
        return Math.random() > 0.2; // 80% success rate
      case "data":
        return Math.random() > 0.1; // 90% success rate
      case "system":
        return Math.random() > 0.5; // 50% success rate
      default:
        return false;
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