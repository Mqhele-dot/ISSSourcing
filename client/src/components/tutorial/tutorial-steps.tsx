// Using TS with our simplified tutorial system
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
        text: "This tutorial will guide you through the main features of the application. We'll cover the key components that help you manage your inventory efficiently."
      },
      {
        id: "dashboard",
        title: "Dashboard",
        text: "The dashboard provides a quick overview of your inventory metrics, recent activities, and important alerts. Use it to monitor your business at a glance."
      },
      {
        id: "navigation",
        title: "Navigation",
        text: "Use the sidebar to navigate between different sections of the application. You can access Inventory, Reports, Suppliers, and more from here."
      },
      {
        id: "user-menu",
        title: "User Menu",
        text: "Access your profile, settings, and logout from the user menu in the top-right corner. You can also set your preferences from this menu."
      },
      {
        id: "tour-complete",
        title: "Tour Complete",
        text: "You've completed the basic tour! Explore other tutorials from the help menu or continue to explore the application on your own."
      }
    ]);
    
    // Dashboard tutorial
    registerTutorial("dashboard", [
      {
        id: "dashboard-intro",
        title: "Dashboard Overview",
        text: "Your dashboard gives you a complete view of your inventory status at a glance."
      },
      {
        id: "dashboard-stats",
        title: "Key Metrics",
        text: "The top cards show total items, low stock alerts, and out-of-stock items. Click any card to see detailed information."
      },
      {
        id: "dashboard-charts",
        title: "Analytics Charts",
        text: "Visual charts display inventory value, stock trends, and movement patterns to help you understand your data."
      },
      {
        id: "dashboard-activity",
        title: "Recent Activity",
        text: "The activity feed shows recent inventory changes, alerts, and system events. Use it to stay updated on all inventory movements."
      },
      {
        id: "dashboard-actions",
        title: "Quick Actions",
        text: "Use the action buttons to quickly add new items, scan barcodes, or generate reports without navigating to different pages."
      }
    ]);
    
    // Inventory management tutorial
    registerTutorial("inventory", [
      {
        id: "inventory-intro",
        title: "Inventory Management",
        text: "The inventory section is where you manage all your products and stock levels. Let's explore its key features."
      },
      {
        id: "inventory-list",
        title: "Item List",
        text: "This table shows all your inventory items with their SKU, quantity, and status. Use the filters to quickly find specific items."
      },
      {
        id: "adding-items",
        title: "Adding New Items",
        text: "Click the 'Add Item' button to create new inventory items. Fill in the required details including name, SKU, category, and initial stock level."
      },
      {
        id: "stock-movements",
        title: "Stock Movements",
        text: "Record stock ins and outs using the movement buttons. Each movement is logged with a timestamp and responsible user."
      },
      {
        id: "multi-warehouse",
        title: "Multi-Warehouse Support",
        text: "Manage inventory across multiple locations by selecting the specific warehouse when viewing or updating stock levels."
      }
    ]);
    
    // Reports tutorial
    registerTutorial("reports", [
      {
        id: "reports-intro",
        title: "Reports & Analytics",
        text: "Generate insights from your inventory data with our reporting tools. Let's see what reports are available."
      },
      {
        id: "report-types",
        title: "Report Types",
        text: "Choose from various report types including inventory valuation, stock movements, sales analysis, and reorder suggestions."
      },
      {
        id: "date-filters",
        title: "Date Range Filters",
        text: "Set specific date ranges to narrow down your reports to relevant time periods. Use presets like 'Last 30 days' or set custom ranges."
      },
      {
        id: "report-visualizations",
        title: "Data Visualizations",
        text: "Switch between table, chart, and card views to visualize your data in different ways depending on your analysis needs."
      },
      {
        id: "export-options",
        title: "Export Options",
        text: "Export your reports in various formats including PDF, Excel, and CSV for further analysis or sharing with your team."
      }
    ]);
    
    // Suppliers tutorial
    registerTutorial("suppliers", [
      {
        id: "suppliers-intro",
        title: "Supplier Management",
        text: "Keep track of all your vendors in one place. Manage contact details, orders, and performance metrics."
      },
      {
        id: "supplier-details",
        title: "Supplier Information",
        text: "Each supplier profile contains contact information, payment terms, lead times, and a complete order history."
      },
      {
        id: "supplier-orders",
        title: "Purchase Orders",
        text: "Create and manage purchase orders directly from the supplier page. Track order status from placement to delivery."
      },
      {
        id: "supplier-performance",
        title: "Performance Metrics",
        text: "Monitor delivery times, quality ratings, and price changes to evaluate supplier performance over time."
      },
      {
        id: "supplier-import",
        title: "Bulk Import",
        text: "Import supplier stock lists directly from Excel files to quickly update your inventory with new products and prices."
      }
    ]);
    
    // User Roles tutorial
    registerTutorial("users", [
      {
        id: "users-intro",
        title: "User Management",
        text: "Control who has access to your inventory system and what actions they can perform."
      },
      {
        id: "user-roles",
        title: "Role-Based Access",
        text: "Assign roles such as Admin, Manager, Warehouse Staff, or Sales to control permissions across the system."
      },
      {
        id: "user-permissions",
        title: "Granular Permissions",
        text: "Fine-tune access rights for each user. Determine who can view, add, edit, or delete inventory items and other data."
      },
      {
        id: "activity-logs",
        title: "User Activity Logs",
        text: "Track all user actions in the system for accountability and security. See who made changes and when."
      },
      {
        id: "user-settings",
        title: "User Preferences",
        text: "Each user can customize their interface preferences, notification settings, and default views."
      }
    ]);
    
    // Settings tutorial
    registerTutorial("settings", [
      {
        id: "settings-intro",
        title: "System Settings",
        text: "Configure your inventory system to match your business needs and workflow preferences."
      },
      {
        id: "company-settings",
        title: "Company Information",
        text: "Update your company details, logo, and contact information which will appear on generated reports and documents."
      },
      {
        id: "inventory-settings",
        title: "Inventory Configuration",
        text: "Set default units of measure, low stock thresholds, and automatic reordering rules for your inventory items."
      },
      {
        id: "notification-settings",
        title: "Notifications",
        text: "Configure alerts for low stock, price changes, and other important events. Set up email or in-app notifications."
      },
      {
        id: "billing-settings",
        title: "Billing Settings",
        text: "Manage your subscription, payment methods, and billing history. Update your plan as your business grows."
      }
    ]);
    
    // Document Generation tutorial
    registerTutorial("documents", [
      {
        id: "documents-intro",
        title: "Document Generation",
        text: "Create professional reports and documents from your inventory data with just a few clicks."
      },
      {
        id: "document-types",
        title: "Available Documents",
        text: "Generate inventory reports, purchase orders, stock transfer forms, and other essential business documents."
      },
      {
        id: "document-customization",
        title: "Customization Options",
        text: "Apply your branding, select included fields, and customize layouts before generating your documents."
      },
      {
        id: "document-formats",
        title: "Output Formats",
        text: "Export documents as PDF for sharing, Excel for further analysis, or CSV for importing into other systems."
      },
      {
        id: "document-automation",
        title: "Automated Reports",
        text: "Schedule regular reports to be generated and emailed to key stakeholders on a daily, weekly, or monthly basis."
      }
    ]);
    
    // Purchase Orders tutorial
    registerTutorial("purchase", [
      {
        id: "purchase-intro",
        title: "Purchase Management",
        text: "Create and manage purchase requisitions and orders to streamline your procurement process."
      },
      {
        id: "requisition-creation",
        title: "Requisition Process",
        text: "Start with a purchase requisition to request approval for needed items before creating an official purchase order."
      },
      {
        id: "po-creation",
        title: "Purchase Order Creation",
        text: "Generate detailed purchase orders with item specifications, quantities, prices, and delivery instructions."
      },
      {
        id: "po-approval",
        title: "Approval Workflow",
        text: "Follow the approval chain to ensure proper authorization before orders are sent to suppliers."
      },
      {
        id: "po-tracking",
        title: "Order Tracking",
        text: "Monitor the status of all purchase orders from creation through delivery and invoice payment."
      }
    ]);
    
    // Barcode Scanner tutorial
    registerTutorial("barcode", [
      {
        id: "barcode-intro",
        title: "Barcode Functionality",
        text: "Use barcodes and QR codes to quickly identify items and update inventory without manual data entry."
      },
      {
        id: "barcode-scanning",
        title: "Scanning Items",
        text: "Use your device's camera to scan barcodes for instant item lookup, stock checks, or movement recording."
      },
      {
        id: "barcode-generation",
        title: "Generate Codes",
        text: "Create new barcodes or QR codes for your items. Print labels directly from the system for application to products."
      },
      {
        id: "bulk-scanning",
        title: "Bulk Operations",
        text: "Perform continuous scanning for receiving shipments or conducting inventory counts. Data is logged in real-time."
      },
      {
        id: "offline-scanning",
        title: "Offline Mode",
        text: "Continue scanning even without internet connection. Data will sync automatically when connection is restored."
      }
    ]);
    
    // Real-time Sync tutorial
    registerTutorial("sync", [
      {
        id: "sync-intro",
        title: "Real-time Synchronization",
        text: "Keep your inventory data up-to-date across all devices and locations with real-time synchronization."
      },
      {
        id: "sync-status",
        title: "Connection Status",
        text: "Monitor your sync status with the indicator in the navigation bar. Green means fully synced, yellow is syncing, red indicates issues."
      },
      {
        id: "offline-mode",
        title: "Offline Capabilities",
        text: "Continue working when offline. All changes are stored locally and synchronized automatically when connection is restored."
      },
      {
        id: "sync-conflicts",
        title: "Conflict Resolution",
        text: "Handle sync conflicts when multiple users update the same item. Review differences and choose which version to keep."
      },
      {
        id: "sync-settings",
        title: "Synchronization Settings",
        text: "Configure sync frequency, bandwidth usage, and data priorities to optimize performance for your network environment."
      }
    ]);
    
    // Billing tutorial
    registerTutorial("billing", [
      {
        id: "billing-intro",
        title: "Billing Management",
        text: "Manage your subscription, invoices, and payment settings to keep your inventory system running smoothly."
      },
      {
        id: "subscription-details",
        title: "Subscription Plan",
        text: "View your current plan features, limitations, and renewal date. Upgrade or downgrade as your business needs change."
      },
      {
        id: "payment-methods",
        title: "Payment Methods",
        text: "Manage your credit cards and other payment options. Set a default payment method for automatic billing."
      },
      {
        id: "invoice-history",
        title: "Invoice History",
        text: "Access and download past invoices for your records. View payment status and transaction details for each billing period."
      },
      {
        id: "billing-notifications",
        title: "Billing Notifications",
        text: "Configure email alerts for upcoming charges, payment confirmations, and subscription changes to avoid service interruptions."
      }
    ]);
    
    // Database Management tutorial
    registerTutorial("database", [
      {
        id: "database-intro",
        title: "Database Management",
        text: "Learn how to set up and manage your PostgreSQL database for optimal performance."
      },
      {
        id: "connection-string",
        title: "Connection String",
        text: "The application connects to PostgreSQL using a connection string in the format: postgresql://username:password@host:port/database"
      },
      {
        id: "db-setup",
        title: "Database Setup",
        text: "Ensure your PostgreSQL server is running and you have created a database for the application. Set the DATABASE_URL environment variable to connect."
      },
      {
        id: "schema-management",
        title: "Schema Management",
        text: "The database schema is defined in shared/schema.ts using Drizzle ORM. Use 'npm run db:push' to update your database after schema changes."
      },
      {
        id: "data-backup",
        title: "Backup and Recovery",
        text: "Regularly back up your database using the export features. For PostgreSQL, you can also use pg_dump for complete database backups."
      }
    ]);
    
  // Empty dependency array since we're using isRegistered.current to prevent re-registration
  }, []);
  
  // This component doesn't render anything visible
  return null;
}