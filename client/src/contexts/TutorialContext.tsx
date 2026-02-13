import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useShepherd } from "react-shepherd";

// Tour context type
type TutorialContextType = {
  activePage: string | null;
  startTutorial: (page: string) => void;
  endTutorial: () => void;
};

// Create the context
const TutorialContext = createContext<TutorialContextType>({
  activePage: null,
  startTutorial: () => {},
  endTutorial: () => {},
});

// Define a more complete step interface to match Shepherd's actual API
interface ShepherdStep {
  id: string;
  text: string;
  attachTo?: { element: string; on: string };
  buttons: { action: () => any; text: string }[];
  beforeShowPromise?: () => Promise<any>;
  [key: string]: any; // Allow for other properties that Shepherd might use
}

// Create the tour steps for each page
const tourSteps: Record<string, ShepherdStep[]> = {
  home: [
    {
      id: "home-welcome",
      text: "Welcome to the Home page! Here you can see visual analytics of your inventory data.",
      attachTo: { element: "h2", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "home-tabs",
      text: "Use these tabs to switch between different analytics views.",
      attachTo: { element: ".space-y-6 > div", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "home-charts",
      text: "These charts provide visual insights into your inventory data, including stock status, item distribution, and more.",
      attachTo: { element: ".space-y-6 > div", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.complete();
          },
          text: "Finish",
        },
      ],
    },
  ],
  dashboard: [
    {
      id: "dashboard-welcome",
      text: "Welcome to the Dashboard! This is where you can see an overview of your inventory.",
      attachTo: { element: ".dashboard-stats", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "dashboard-low-stock",
      text: "Here you can see items that are running low on stock and need attention.",
      attachTo: { element: ".low-stock-items", on: "left" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "dashboard-add-item",
      text: "Click here to add a new inventory item quickly.",
      attachTo: { element: ".add-item-button", on: "left" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.complete();
          },
          text: "Finish",
        },
      ],
    },
  ],
  inventory: [
    {
      id: "inventory-welcome",
      text: "Welcome to the Inventory page! Here you can manage all your inventory items.",
      attachTo: { element: ".inventory-header", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "inventory-table",
      text: "This table shows all your inventory items with key information.",
      attachTo: { element: ".inventory-table", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "inventory-search",
      text: "You can search for items by name, SKU, or other properties.",
      attachTo: { element: ".inventory-search", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "inventory-filters",
      text: "Filter your inventory by category, stock level, or other criteria.",
      attachTo: { element: ".inventory-filters", on: "left" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.complete();
          },
          text: "Finish",
        },
      ],
    },
  ],
  orders: [
    {
      id: "orders-welcome",
      text: "Welcome to the Orders page! Here you can manage purchase requisitions and orders.",
      attachTo: { element: ".orders-tabs", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "orders-requisitions",
      text: "Purchase requisitions are internal requests to purchase items.",
      attachTo: { element: ".requisitions-table", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "orders-purchase-orders",
      text: "Purchase orders are formal documents sent to suppliers to order goods.",
      attachTo: { element: ".purchase-orders-table", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "orders-create-button",
      text: "Use this button to create a new requisition or purchase order.",
      attachTo: { element: ".create-order-button", on: "left" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.complete();
          },
          text: "Finish",
        },
      ],
    },
  ],
  suppliers: [
    {
      id: "suppliers-welcome",
      text: "Welcome to the Suppliers page! Here you can manage your supplier information.",
      attachTo: { element: ".suppliers-header", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "suppliers-list",
      text: "This list shows all your suppliers with their contact information.",
      attachTo: { element: ".suppliers-list", on: "right" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "suppliers-form",
      text: "Use this form to add a new supplier or edit an existing one.",
      attachTo: { element: ".supplier-form", on: "left" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "suppliers-logo",
      text: "You can add or update a logo for each supplier to easily identify them.",
      attachTo: { element: ".supplier-logo-btn", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.complete();
          },
          text: "Finish",
        },
      ],
    },
  ],
  settings: [
    {
      id: "settings-welcome",
      text: "Welcome to the Settings page! Here you can customize your application.",
      attachTo: { element: ".settings-header", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "settings-tabs",
      text: "Use these tabs to navigate between different categories of settings.",
      attachTo: { element: ".settings-tabs", on: "bottom" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "settings-company",
      text: "Set your company information which will be used in the application and documents.",
      attachTo: { element: ".company-settings", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "settings-appearance",
      text: "Customize the appearance of your application with colors and themes.",
      attachTo: { element: ".appearance-settings", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.next();
          },
          text: "Next",
        },
      ],
    },
    {
      id: "settings-inventory",
      text: "Configure how inventory items are managed and displayed.",
      attachTo: { element: ".inventory-settings", on: "top" },
      buttons: [
        {
          action: () => {
            return (window as any).shepherdTour.back();
          },
          text: "Back",
        },
        {
          action: () => {
            return (window as any).shepherdTour.complete();
          },
          text: "Finish",
        },
      ],
    },
  ],
};

// Tour config
const tourConfig = {
  defaultStepOptions: {
    cancelIcon: {
      enabled: true,
    },
    classes: "shepherd-theme-custom",
    scrollTo: true,
  },
  useModalOverlay: true,
};

// Provider component
export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePage, setActivePage] = useState<string | null>(null);
  // Use any to avoid TypeScript errors - the actual implementation will work at runtime
  const shepherd = useShepherd() as any;
  
  // Store the tour instance
  const tourRef = useRef<any>(null);

  // Initialize global shepherdTour for button actions
  useEffect(() => {
    if (shepherd) {
      (window as any).shepherdTour = shepherd;
    }
  }, [shepherd]);

  // Start the tutorial for a specific page
  const startTutorial = (page: string) => {
    setActivePage(page);
    
    // Get the steps for this page
    const steps = tourSteps[page as keyof typeof tourSteps] || [];
    
    if (shepherd && steps.length > 0) {
      // Cancel any existing tour
      if (tourRef.current) {
        try {
          shepherd.cancel();
        } catch (e) {
          console.log("No active tour to cancel");
        }
      }
      
      // Remove existing steps if any
      try {
        if (shepherd.steps && shepherd.steps.length > 0) {
          // Clear existing steps - this approach depends on the Shepherd implementation
          shepherd.steps.forEach((step: any) => {
            if (step && step.id) {
              shepherd.removeStep(step.id);
            }
          });
        }
      } catch (e) {
        console.log("Error clearing steps", e);
      }
      
      // Add steps for the new tour with modified attachTo behavior
      steps.forEach(step => {
        try {
          // Create a copy of the step to modify
          const modifiedStep = { ...step };
          
          // Check if the element exists before attaching
          if (modifiedStep.attachTo && modifiedStep.attachTo.element) {
            const elementSelector = modifiedStep.attachTo.element;
            // Wait for element to be available or proceed without attaching
            modifiedStep.beforeShowPromise = function() {
              return new Promise((resolve) => {
                // First check if element exists
                if (document.querySelector(elementSelector)) {
                  resolve(true);
                  return;
                }
                
                // If not, try again after DOM is ready
                setTimeout(() => {
                  // If still doesn't exist, just continue without attaching
                  resolve(true);
                }, 100);
              });
            };
          }
          
          shepherd.addStep(modifiedStep);
        } catch (e) {
          console.warn(`Error adding step ${step.id}`, e);
        }
      });
      
      // Store reference to current tour
      tourRef.current = shepherd;
      
      // Start the tour after a brief delay to ensure DOM is ready
      setTimeout(() => {
        try {
          shepherd.start();
        } catch (e) {
          console.warn("Error starting tour", e);
        }
      }, 500); // Increased delay to ensure DOM is more fully loaded
    } else {
      console.warn("Cannot start tutorial: Shepherd not initialized or no steps for page", page);
    }
  };

  // End the tutorial
  const endTutorial = () => {
    if (shepherd) {
      try {
        shepherd.cancel();
      } catch (e) {
        console.log("Error cancelling tour", e);
      }
    }
    setActivePage(null);
  };

  return (
    <TutorialContext.Provider value={{ activePage, startTutorial, endTutorial }}>
      {children}
    </TutorialContext.Provider>
  );
};

// Hook for using tutorial context
export const useTutorial = () => useContext(TutorialContext);