// @ts-nocheck - Disable TypeScript checking for this file as we're dealing with Shepherd.js's special 'this' context
// which is difficult to type properly in TypeScript without complex type gymnastics
import { useEffect } from "react";
import { useTutorial } from "@/contexts/tutorial-context";

/**
 * Component to register all available tutorials in the application
 */
export function TutorialSteps() {
  const { registerTutorial } = useTutorial();
  
  useEffect(() => {
    // Main tutorial - a general introduction to the application
    registerTutorial("main", [
      {
        id: "welcome",
        title: "Welcome to Inventory Manager",
        text: "This tutorial will guide you through the main features of the application. Click 'Next' to continue or 'Skip' to exit the tour at any time.",
        attachTo: {
          element: ".main-logo",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.cancel();
            },
            text: "Skip"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "dashboard",
        title: "Dashboard",
        text: "The dashboard provides a quick overview of your inventory metrics, recent activities, and important alerts.",
        attachTo: {
          element: ".dashboard-stats",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "navigation",
        title: "Navigation",
        text: "Use the sidebar to navigate between different sections of the application.",
        attachTo: {
          element: ".main-nav",
          on: "right"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "user-menu",
        title: "User Menu",
        text: "Access your profile, settings, and logout from the user menu in the top-right corner.",
        attachTo: {
          element: ".user-menu",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "tour-complete",
        title: "Tour Complete",
        text: "You've completed the basic tour! Explore other tutorials from the help menu or continue to explore the application on your own.",
        buttons: [
          {
            action() {
              return this.complete();
            },
            text: "Finish"
          }
        ]
      }
    ]);
    
    // Inventory management tutorial
    registerTutorial("inventory", [
      {
        id: "inventory-intro",
        title: "Inventory Management",
        text: "Learn how to effectively manage your inventory items, track stock levels, and handle stock movements.",
        buttons: [
          {
            action() {
              return this.cancel();
            },
            text: "Skip"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "adding-items",
        title: "Adding New Items",
        text: "Click the 'Add Item' button to create new inventory items. Fill in the required details including name, SKU, category, and initial stock level.",
        attachTo: {
          element: ".add-item-btn",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "stock-tracking",
        title: "Stock Tracking",
        text: "Monitor current stock levels across different warehouses. Items below their minimum threshold will be highlighted for your attention.",
        attachTo: {
          element: ".stock-level-indicator",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "barcode-scanning",
        title: "Barcode Scanning",
        text: "Use the barcode scanning feature to quickly look up items or record stock movements without manual data entry.",
        attachTo: {
          element: ".barcode-scanner-btn",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "inventory-complete",
        title: "Inventory Tutorial Complete",
        text: "You now understand the basics of inventory management! Remember to regularly update your stock levels and set appropriate reorder points.",
        buttons: [
          {
            action() {
              return this.complete();
            },
            text: "Finish"
          }
        ]
      }
    ]);
    
    // Reports tutorial
    registerTutorial("reports", [
      {
        id: "reports-intro",
        title: "Reports & Analytics",
        text: "Learn how to generate useful insights from your inventory data with our reporting tools.",
        buttons: [
          {
            action() {
              return this.cancel();
            },
            text: "Skip"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "report-types",
        title: "Report Types",
        text: "Choose from various report types including inventory valuation, stock movements, sales analysis, and reorder suggestions.",
        attachTo: {
          element: ".report-type-selector",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "date-filters",
        title: "Date Range Filters",
        text: "Set specific date ranges to narrow down your reports to relevant time periods.",
        attachTo: {
          element: ".date-range-picker",
          on: "bottom"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "export-options",
        title: "Export Options",
        text: "Export your reports in various formats including PDF, Excel, and CSV for further analysis or sharing.",
        attachTo: {
          element: ".export-options",
          on: "left"
        },
        buttons: [
          {
            action() {
              return this.back();
            },
            text: "Back"
          },
          {
            action() {
              return this.next();
            },
            text: "Next"
          }
        ]
      },
      {
        id: "reports-complete",
        title: "Reports Tutorial Complete",
        text: "You now know how to generate detailed reports for your inventory! Use these insights to make data-driven decisions for your business.",
        buttons: [
          {
            action() {
              return this.complete();
            },
            text: "Finish"
          }
        ]
      }
    ]);
    
  }, [registerTutorial]);
  
  // This component doesn't render anything visible
  return null;
}