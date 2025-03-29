import React, { createContext, useContext, useState } from 'react';
import { useShepherd } from 'react-shepherd';
import 'shepherd.js/dist/css/shepherd.css';

// Custom type for Shepherd Tour
interface ShepherdTour {
  addSteps: (steps: any[]) => void;
  start: () => void;
  once: (event: string, callback: () => void) => void;
  steps: {
    id: string;
  }[];
  removeStep: (id: string) => void;
}

type TutorialContextType = {
  startTutorial: (page: string) => void;
  isTutorialActive: boolean;
};

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

// Define tutorial steps for each page
const tutorialSteps = {
  dashboard: [
    {
      id: 'dashboard-welcome',
      title: 'Welcome to the Dashboard',
      text: 'This is the main dashboard where you can see an overview of your inventory.',
      attachTo: { element: '.dashboard-stats', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'dashboard-low-stock',
      title: 'Low Stock Items',
      text: 'Here you can quickly see items that are running low and need to be reordered.',
      attachTo: { element: '.low-stock-section', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'dashboard-recent-activity',
      title: 'Recent Activity',
      text: 'Track recent changes and activities in your inventory system here.',
      attachTo: { element: '.activity-log-section', on: 'top' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.complete();
          },
          text: 'Finish'
        }
      ]
    }
  ],
  inventory: [
    {
      id: 'inventory-welcome',
      title: 'Inventory Management',
      text: 'This is where you manage all your inventory items.',
      attachTo: { element: '.inventory-header', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'inventory-add-item',
      title: 'Add New Items',
      text: 'Click here to add new items to your inventory.',
      attachTo: { element: '.add-item-button', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'inventory-search',
      title: 'Search Inventory',
      text: 'Quickly find items using the search feature.',
      attachTo: { element: '.search-input', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'inventory-table',
      title: 'Inventory Table',
      text: 'View all your items here with details like quantity, price, and more.',
      attachTo: { element: '.inventory-table', on: 'top' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.complete();
          },
          text: 'Finish'
        }
      ]
    }
  ],
  reports: [
    {
      id: 'reports-welcome',
      title: 'Reports Section',
      text: 'Generate various reports about your inventory and orders here.',
      attachTo: { element: '.reports-header', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'reports-type-selection',
      title: 'Report Type',
      text: 'Select the type of report you want to generate.',
      attachTo: { element: '.report-type-selector', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'reports-format-selection',
      title: 'Report Format',
      text: 'Choose the format for your report (PDF, CSV, or Excel).',
      attachTo: { element: '.report-format-selector', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'reports-generate',
      title: 'Generate Report',
      text: 'Click here to generate your report with the selected options.',
      attachTo: { element: '.generate-report-button', on: 'left' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.complete();
          },
          text: 'Finish'
        }
      ]
    }
  ],
  purchaseRequisitions: [
    {
      id: 'requisitions-welcome',
      title: 'Purchase Requisitions',
      text: 'Manage your purchase requisitions from this page.',
      attachTo: { element: '.requisitions-header', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'requisitions-create',
      title: 'Create Requisition',
      text: 'Start a new purchase requisition by clicking here.',
      attachTo: { element: '.create-requisition-button', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'requisitions-table',
      title: 'Requisitions Table',
      text: 'View and manage all your requisitions from this table.',
      attachTo: { element: '.requisitions-table', on: 'top' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.complete();
          },
          text: 'Finish'
        }
      ]
    }
  ],
  purchaseOrders: [
    {
      id: 'orders-welcome',
      title: 'Purchase Orders',
      text: 'Manage your purchase orders from this page.',
      attachTo: { element: '.orders-header', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'orders-create',
      title: 'Create Order',
      text: 'Create a new purchase order by clicking here.',
      attachTo: { element: '.create-order-button', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'orders-table',
      title: 'Orders Table',
      text: 'View and manage all your purchase orders from this table.',
      attachTo: { element: '.orders-table', on: 'top' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.complete();
          },
          text: 'Finish'
        }
      ]
    }
  ],
  suppliers: [
    {
      id: 'suppliers-welcome',
      title: 'Suppliers Management',
      text: 'Manage your suppliers from this page.',
      attachTo: { element: '.suppliers-header', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'suppliers-add',
      title: 'Add Supplier',
      text: 'Add a new supplier by clicking here.',
      attachTo: { element: '.add-supplier-button', on: 'bottom' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.next();
          },
          text: 'Next'
        }
      ]
    },
    {
      id: 'suppliers-table',
      title: 'Suppliers Table',
      text: 'View and manage all your suppliers from this table.',
      attachTo: { element: '.suppliers-table', on: 'top' },
      buttons: [
        {
          action: function() {
            return this.back();
          },
          text: 'Back'
        },
        {
          action: function() {
            return this.complete();
          },
          text: 'Finish'
        }
      ]
    }
  ],
};

export const TutorialProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isTutorialActive, setIsTutorialActive] = useState<boolean>(false);
  const shepherd = useShepherd() as unknown as ShepherdTour;

  const startTutorial = (page: string) => {
    if (!tutorialSteps[page as keyof typeof tutorialSteps]) {
      console.error(`No tutorial steps found for page: ${page}`);
      return;
    }

    // Configure the tour
    if (shepherd.addSteps) {
      shepherd.addSteps(tutorialSteps[page as keyof typeof tutorialSteps]);
      
      // Set tutorial as active
      setIsTutorialActive(true);
      
      // Start the tour
      shepherd.start();
      
      // When tour completes or is canceled
      shepherd.once('complete', () => {
        setIsTutorialActive(false);
        if (shepherd.steps) {
          shepherd.steps.forEach((step: any) => {
            if (step.id && shepherd.removeStep) {
              shepherd.removeStep(step.id);
            }
          });
        }
      });
      
      shepherd.once('cancel', () => {
        setIsTutorialActive(false);
        if (shepherd.steps) {
          shepherd.steps.forEach((step: any) => {
            if (step.id && shepherd.removeStep) {
              shepherd.removeStep(step.id);
            }
          });
        }
      });
    }
  };

  const value = { startTutorial, isTutorialActive };

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
};

export const useTutorial = () => {
  const context = useContext(TutorialContext);
  if (context === undefined) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return context;
};