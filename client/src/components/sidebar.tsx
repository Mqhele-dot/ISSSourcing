import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import {
  Activity,
  Archive,
  Building,
  Camera,
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
            "flex items-center px-4 py-2.5 text-sm font-medium rounded-md cursor-pointer transition-all",
            isActive(path)
              ? "accent-gradient-bg text-primary-foreground elev-2"
              : "text-foreground/90 hover:bg-muted"
          )}
          {...(helpTitle
            ? {
                "data-help-title": helpTitle,
                "data-help-description": helpDescription ?? "",
              }
            : {})}
        >
          {icon}
          {children}
        </div>
      </Link>
    );
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/90">
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
            <SectionTitle>Overview</SectionTitle>
            <NavItem path="/" icon={<Home className="mr-3 h-5 w-5" />} helpTitle="Home" helpDescription="Landing page and quick overview of the app." />
            <NavItem path="/dashboard" icon={<LayoutDashboard className="mr-3 h-5 w-5" />} helpTitle="Dashboard" helpDescription="Overview of inventory status, stats, charts, and recent orders." />

            <SectionTitle>Inventory</SectionTitle>
            <NavItem path="/inventory" icon={<Archive className="mr-3 h-5 w-5" />} helpTitle="Inventory" helpDescription="Manage products, stock levels, and item details." />
            <NavItem path="/barcode-scanner" icon={<QrCode className="mr-3 h-5 w-5" />} helpTitle="Barcode Scanner" helpDescription="Scan and generate barcodes for inventory items." />
            <NavItem path="/image-recognition" icon={<Camera className="mr-3 h-5 w-5" />} helpTitle="Image Recognition" helpDescription="Identify items or extract data from product images." />

            <SectionTitle>Purchase Orders</SectionTitle>
            <NavItem path="/purchase" icon={<ShoppingCart className="mr-3 h-5 w-5" />} helpTitle="Purchase Orders" helpDescription="Create and manage purchase orders and requisitions." />
            <NavItem path="/suppliers" icon={<Users className="mr-3 h-5 w-5" />} helpTitle="Suppliers" helpDescription="Manage vendor information and contacts." />
            <NavItem path="/contracts" icon={<FileText className="mr-3 h-5 w-5" />} helpTitle="Contracts" helpDescription="Manage contracts with each supplier, view summaries, and find copies." />

            <SectionTitle>Logistics</SectionTitle>
            <NavItem path="/logistics" icon={<Building className="mr-3 h-5 w-5" />} helpTitle="Shipments" helpDescription="Track shipments and logistics." />
            <NavItem path="/warehouses" icon={<Building className="mr-3 h-5 w-5" />} helpTitle="Warehouses" helpDescription="Manage warehouse locations and stock." />
            <NavItem path="/reorder" icon={<RefreshCw className="mr-3 h-5 w-5" />} helpTitle="Reorder Requests" helpDescription="View and manage reorder requests." />

            <SectionTitle>Exceptions</SectionTitle>
            <NavItem path="/exceptions" icon={<Activity className="mr-3 h-5 w-5" />} helpTitle="Exceptions" helpDescription="View and resolve inventory or order exceptions." />

            <SectionTitle>Integrations</SectionTitle>
            <NavItem path="/integrations" icon={<FileUp className="mr-3 h-5 w-5" />} helpTitle="Connectors" helpDescription="Connect external systems and data sources." />
            <NavItem path="/document-extractor" icon={<FileUp className="mr-3 h-5 w-5" />} helpTitle="Document Extractor" helpDescription="Extract data from documents (e.g. invoices)." />

            <SectionTitle>Settings</SectionTitle>
            <NavItem path="/reports" icon={<FileText className="mr-3 h-5 w-5" />} helpTitle="Reports" helpDescription="Analytics and custom reports (PDF, Excel, CSV)." />
            <NavItem path="/settings" icon={<Settings className="mr-3 h-5 w-5" />} helpTitle="Settings" helpDescription="Configure application preferences." />
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
