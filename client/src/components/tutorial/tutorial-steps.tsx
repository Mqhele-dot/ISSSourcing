// Using TS now that we've simplified the tutorial system
import { useRef, useEffect } from "react";
import { useTutorial } from "@/contexts/tutorial-context";

/**
 * Component to register all available tutorials in the application
 */
export function TutorialSteps() {
  const { registerTutorial } = useTutorial();
  // Use ref to prevent multiple registrations
  const isRegistered = useRef(false);
  
  useEffect(() => {
    // Only register tutorials once to prevent re-registering on every render
    if (isRegistered.current) return;
    isRegistered.current = true;
    
    // Main tutorial - a general introduction to the application
    registerTutorial("main", [
      {
        id: "welcome",
        title: "Welcome to Inventory Manager",
        text: "This tutorial will guide you through the main features of the application."
      },
      {
        id: "dashboard",
        title: "Dashboard",
        text: "The dashboard provides a quick overview of your inventory metrics, recent activities, and important alerts."
      },
      {
        id: "navigation",
        title: "Navigation",
        text: "Use the sidebar to navigate between different sections of the application."
      },
      {
        id: "user-menu",
        title: "User Menu",
        text: "Access your profile, settings, and logout from the user menu in the top-right corner."
      },
      {
        id: "tour-complete",
        title: "Tour Complete",
        text: "You've completed the basic tour! Explore other tutorials from the help menu or continue to explore the application on your own."
      }
    ]);
    
    // Inventory management tutorial
    registerTutorial("inventory", [
      {
        id: "inventory-intro",
        title: "Inventory Management",
        text: "Learn how to effectively manage your inventory items, track stock levels, and handle stock movements."
      },
      {
        id: "adding-items",
        title: "Adding New Items",
        text: "Click the 'Add Item' button to create new inventory items. Fill in the required details including name, SKU, category, and initial stock level."
      },
      {
        id: "stock-tracking",
        title: "Stock Tracking",
        text: "Monitor current stock levels across different warehouses. Items below their minimum threshold will be highlighted for your attention."
      },
      {
        id: "barcode-scanning",
        title: "Barcode Scanning",
        text: "Use the barcode scanning feature to quickly look up items or record stock movements without manual data entry."
      },
      {
        id: "inventory-complete",
        title: "Inventory Tutorial Complete",
        text: "You now understand the basics of inventory management! Remember to regularly update your stock levels and set appropriate reorder points."
      }
    ]);
    
    // Reports tutorial
    registerTutorial("reports", [
      {
        id: "reports-intro",
        title: "Reports & Analytics",
        text: "Learn how to generate useful insights from your inventory data with our reporting tools."
      },
      {
        id: "report-types",
        title: "Report Types",
        text: "Choose from various report types including inventory valuation, stock movements, sales analysis, and reorder suggestions."
      },
      {
        id: "date-filters",
        title: "Date Range Filters",
        text: "Set specific date ranges to narrow down your reports to relevant time periods."
      },
      {
        id: "export-options",
        title: "Export Options",
        text: "Export your reports in various formats including PDF, Excel, and CSV for further analysis or sharing."
      },
      {
        id: "reports-complete",
        title: "Reports Tutorial Complete",
        text: "You now know how to generate detailed reports for your inventory! Use these insights to make data-driven decisions for your business."
      }
    ]);
    
  // Empty dependency array since we're using isRegistered.current to prevent re-registration
  }, []);
  
  // This component doesn't render anything visible
  return null;
}