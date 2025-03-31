import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import "shepherd.js/dist/css/shepherd.css";

interface TutorialContextType {
  startTutorial: (tourId?: string) => void;
  endTutorial: () => void;
  isTutorialActive: boolean;
  registerTutorial: (tourId: string, steps: any[]) => void;
  scanForErrors: () => Promise<{ [key: string]: string[] }>;
  fixErrors: (errorType: string) => Promise<boolean>;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

interface TutorialProviderProps {
  children: ReactNode;
}

export function TutorialProvider({ children }: TutorialProviderProps) {
  const [isTutorialActive, setIsTutorialActive] = useState(false);
  const [activeTour, setActiveTour] = useState<string | null>(null);
  const [tutorials, setTutorials] = useState<{ [key: string]: any[] }>({});

  // Register a new tutorial with steps
  const registerTutorial = (tourId: string, steps: any[]) => {
    setTutorials(prev => ({
      ...prev,
      [tourId]: steps
    }));
  };

  // Start a tutorial
  const startTutorial = (tourId = "main") => {
    if (!tutorials[tourId]) {
      console.error(`Tutorial with ID "${tourId}" not found.`);
      return;
    }

    setActiveTour(tourId);
    setIsTutorialActive(true);
    
    // In a real implementation, this would trigger the tutorial to start
    console.log(`Starting tutorial: ${tourId} with ${tutorials[tourId].length} steps`);
    
    // Simulate tour starting and completing after 5 seconds
    setTimeout(() => {
      setIsTutorialActive(false);
      setActiveTour(null);
    }, 5000);
  };

  // End the current tutorial
  const endTutorial = () => {
    setIsTutorialActive(false);
    setActiveTour(null);
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
    registerTutorial,
    scanForErrors,
    fixErrors
  };
  
  return (
    <TutorialContext.Provider value={contextValue}>
      {children}
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