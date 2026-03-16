import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import {
  Activity,
  Archive,
  BarChart2,
  Building,
  Camera,
  Database,
  FileText,
  FileUp,
  Home,
  LayoutDashboard,
  Moon,
  QrCode,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sun,
  Users,
  X,
} from "lucide-react";

interface SidebarProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function Sidebar({ open, setOpen }: SidebarProps) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  const isActive = (path: string) => {
    if (location === path) {
      return true;
    }
    if (path !== "/" && location.startsWith(`${path}/`)) {
      return true;
    }
    return false;
  };

  const NavItem = ({
    path,
    icon,
    children,
    helpTitle,
    helpDescription,
  }: {
    path: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    helpTitle?: string;
    helpDescription?: string;
  }) => {
    return (
      <Link href={path}>
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-md cursor-pointer transition-all",
            isActive(path)
              ? "accent-gradient-bg text-primary-foreground elev-2"
              : "text-foreground hover:bg-muted"
          )}
          {...(helpTitle
            ? {
                "data-help-title": helpTitle,
                "data-help-description": helpDescription ?? "",
              }
            : {})}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-inherit" title={helpTitle ?? (typeof children === "string" ? children : undefined)}>
            {children}
          </span>
        </div>
      </Link>
    );
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border shadow-[var(--shadow-elev-1)] accent-glow transition-transform duration-200 transform md:translate-x-0 md:static md:z-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="h-8 w-8 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 18H4V6H20V18Z" />
                <path d="M6 14H18V16H6V14Z" />
                <path d="M6 11H18V13H6V11Z" />
                <path d="M6 8H18V10H6V8Z" />
              </svg>
              <h1 className="ml-2 text-xl font-semibold text-primary">InvTrack</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
        
        <nav className="flex-1 px-2 py-4 overflow-y-auto">
          <div className="space-y-1">
            <SectionTitle>Control Tower</SectionTitle>
            <NavItem path="/" icon={<Home className="h-5 w-5" />} helpTitle="Home" helpDescription="Landing page and quick overview of the app.">Home</NavItem>
            <NavItem path="/dashboard" icon={<LayoutDashboard className="h-5 w-5" />} helpTitle="Dashboard" helpDescription="Overview of inventory status, stats, charts, and recent orders.">Dashboard</NavItem>
            <NavItem path="/analytics" icon={<BarChart2 className="h-5 w-5" />} helpTitle="Analytics" helpDescription="Charts, top items, inventory value, and custom graphs.">Analytics</NavItem>

            <SectionTitle>Master Data</SectionTitle>
            <NavItem path="/inventory" icon={<Archive className="h-5 w-5" />} helpTitle="Inventory" helpDescription="Manage products, stock levels, and item details.">Inventory</NavItem>
            <NavItem path="/master-data" icon={<Database className="h-5 w-5" />} helpTitle="Master Data" helpDescription="Manage reference data like units, currencies, tax codes, payment terms, and departments.">Master Data</NavItem>
            <NavItem path="/suppliers" icon={<Users className="h-5 w-5" />} helpTitle="Suppliers" helpDescription="Manage vendor information and contacts.">Suppliers</NavItem>
            <NavItem path="/warehouses" icon={<Building className="h-5 w-5" />} helpTitle="Warehouses" helpDescription="Manage warehouse locations and stock.">Warehouses</NavItem>
            <NavItem path="/barcode-scanner" icon={<QrCode className="h-5 w-5" />} helpTitle="Barcode Scanner" helpDescription="Scan and generate barcodes for inventory items.">Barcode Scanner</NavItem>
            <NavItem path="/image-recognition" icon={<Camera className="h-5 w-5" />} helpTitle="Image Recognition" helpDescription="Identify items or extract data from product images.">Image Recognition</NavItem>

            <SectionTitle>Procurement</SectionTitle>
            <NavItem path="/purchase" icon={<ShoppingCart className="h-5 w-5" />} helpTitle="Purchase Orders" helpDescription="View and manage purchase orders. Use the Requisitions tab to create or approve requisitions.">Purchase Orders</NavItem>
            <NavItem path="/purchase/requisitions" icon={<FileText className="h-5 w-5" />} helpTitle="Requisitions" helpDescription="Create, edit, approve, and share purchase requisitions; convert approved ones to purchase orders.">Requisitions</NavItem>
            <NavItem path="/invoices" icon={<FileText className="h-5 w-5" />} helpTitle="Invoices" helpDescription="Create and manage supplier invoices linked to purchase orders, and run 3-way match checks.">Invoices</NavItem>
            <NavItem path="/supplier-portal" icon={<Users className="h-5 w-5" />} helpTitle="Supplier Portal" helpDescription="Supplier-facing view for confirming POs and updating expected delivery dates.">Supplier Portal</NavItem>

            <SectionTitle>Inventory Operations</SectionTitle>
            <NavItem path="/cycle-counts" icon={<RefreshCw className="h-5 w-5" />} helpTitle="Cycle Counts" helpDescription="Plan and post cycle counts with automatic stock adjustment entries.">Cycle Counts</NavItem>
            <NavItem path="/reorder" icon={<RefreshCw className="h-5 w-5" />} helpTitle="Reorder Requests" helpDescription="View and manage reorder requests.">Reorder Requests</NavItem>

            <SectionTitle>Logistics</SectionTitle>
            <NavItem path="/logistics" icon={<Building className="h-5 w-5" />} helpTitle="Shipments" helpDescription="Track shipments and logistics.">Shipments</NavItem>

            <SectionTitle>Finance</SectionTitle>
            <NavItem path="/billing" icon={<FileText className="h-5 w-5" />} helpTitle="Payments & Billing" helpDescription="Track payments and billing configuration.">Payments</NavItem>

            <SectionTitle>Compliance</SectionTitle>
            <NavItem path="/contracts" icon={<FileText className="h-5 w-5" />} helpTitle="Contracts" helpDescription="Manage contracts with each supplier, view summaries, and find copies.">Contracts</NavItem>
            <NavItem path="/audit-logs" icon={<Activity className="h-5 w-5" />} helpTitle="Audit Logs" helpDescription="Filter and export audit/activity records for compliance review.">Audit Logs</NavItem>
            <NavItem path="/documents" icon={<FileUp className="h-5 w-5" />} helpTitle="Documents" helpDescription="Upload and manage document versions with retention support.">Documents</NavItem>
            <NavItem path="/exceptions" icon={<Activity className="h-5 w-5" />} helpTitle="Exceptions" helpDescription="View and resolve inventory or order exceptions.">Exceptions</NavItem>

            <SectionTitle>Analytics</SectionTitle>
            <NavItem path="/reports" icon={<FileText className="h-5 w-5" />} helpTitle="Reports" helpDescription="Analytics and custom reports (PDF, Excel, CSV).">Reports</NavItem>
            <NavItem path="/supply-analytics" icon={<BarChart2 className="h-5 w-5" />} helpTitle="Supply Analytics" helpDescription="Spend, turnover, and warehouse utilization snapshots.">Supply Analytics</NavItem>

            <SectionTitle>Settings</SectionTitle>
            <NavItem path="/integrations" icon={<FileUp className="h-5 w-5" />} helpTitle="Connectors" helpDescription="Connect external systems and data sources.">Connectors</NavItem>
            <NavItem path="/document-extractor" icon={<FileUp className="h-5 w-5" />} helpTitle="Document Extractor" helpDescription="Extract data from documents (e.g. invoices).">Document Extractor</NavItem>
            <NavItem path="/employee-profiles" icon={<Users className="h-5 w-5" />} helpTitle="Employee Profiles" helpDescription="Manage employee profile information, roles, permissions, and activity.">Employee Profiles</NavItem>
            <NavItem path="/settings" icon={<Settings className="h-5 w-5" />} helpTitle="Settings" helpDescription="Configure application preferences.">Settings</NavItem>
          </div>
        </nav>
        
        <div className="p-4 border-t border-border">
          <Button
            variant="ghost"
            className="w-full justify-start"
            data-help-title="Theme toggle"
            data-help-description="Switch between light and dark mode."
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <>
                <Sun className="mr-2 h-5 w-5" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="mr-2 h-5 w-5" />
                <span>Dark Mode</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
