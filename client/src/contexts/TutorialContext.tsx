import React, { createContext, useContext, useState } from "react";
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

// Create the tour steps for each page
const tourSteps = {
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
  const shepherd = useShepherd();

  // Start the tutorial for a specific page
  const startTutorial = (page: string) => {
    setActivePage(page);
    
    // Get the steps for this page
    const steps = tourSteps[page as keyof typeof tourSteps] || [];
    
    // Add steps to the tour and start it
    if (shepherd && steps.length > 0) {
      // Clear previous steps
      if (shepherd.Tour?.steps && shepherd.Tour.steps.length > 0) {
        shepherd.Tour.steps.forEach((step: any) => {
          if (step && step.id) {
            shepherd.Tour?.removeStep(step.id);
          }
        });
      }
      
      // Add new steps
      steps.forEach((step) => {
        shepherd.Tour?.addStep(step);
      });
      
      // Start the tour
      setTimeout(() => {
        shepherd.Tour?.start();
      }, 100);
    }
  };

  // End the tutorial
  const endTutorial = () => {
    if (shepherd && shepherd.Tour) {
      shepherd.Tour.complete();
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