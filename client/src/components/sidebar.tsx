import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { Archive, BarChart3, Building, ChevronRight, FileText, Home, Moon, Settings, ShoppingCart, Sun, Users, X, LayoutDashboard, RefreshCw, QrCode, Activity, Zap, FileUp, Camera } from "lucide-react";

interface SidebarProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export default function Sidebar({ open, setOpen }: SidebarProps) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  const isActive = (path: string) => {
    return location === path;
  };

  const NavItem = ({ path, icon, children }: { path: string, icon: React.ReactNode, children: React.ReactNode }) => {
    return (
      <Link href={path}>
        <div
          className={cn(
            "flex items-center px-4 py-2.5 text-sm font-medium rounded-md cursor-pointer",
            isActive(path)
              ? "bg-primary text-white hover:bg-primary/90"
              : "text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700"
          )}
        >
          {icon}
          {children}
        </div>
      </Link>
    );
  };

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
          "fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 shadow-sm transition-transform duration-200 transform md:translate-x-0 md:static md:z-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="h-8 w-8 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 18H4V6H20V18Z" />
                <path d="M6 14H18V16H6V14Z" />
                <path d="M6 11H18V13H6V11Z" />
                <path d="M6 8H18V10H6V8Z" />
              </svg>
              <h1 className="ml-2 text-xl font-semibold text-primary dark:text-white">InvTrack</h1>
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
          <div className="space-y-2">
            <NavItem path="/" icon={<Home className="mr-3 h-5 w-5" />}>
              Home
            </NavItem>
            
            <NavItem path="/dashboard" icon={<LayoutDashboard className="mr-3 h-5 w-5" />}>
              Dashboard
            </NavItem>
            
            <NavItem path="/inventory" icon={<Archive className="mr-3 h-5 w-5" />}>
              Inventory
            </NavItem>
            
            <NavItem path="/orders" icon={<ShoppingCart className="mr-3 h-5 w-5" />}>
              Orders
            </NavItem>
            
            <NavItem path="/reorder" icon={<RefreshCw className="mr-3 h-5 w-5" />}>
              Reorder Requests
            </NavItem>
            
            <NavItem path="/suppliers" icon={<Users className="mr-3 h-5 w-5" />}>
              Suppliers
            </NavItem>
            
            <NavItem path="/warehouses" icon={<Building className="mr-3 h-5 w-5" />}>
              Warehouses
            </NavItem>
            
            <NavItem path="/reports" icon={<FileText className="mr-3 h-5 w-5" />}>
              Reports
            </NavItem>
            
            <NavItem path="/barcode-scanner" icon={<QrCode className="mr-3 h-5 w-5" />}>
              Barcode Scanner
            </NavItem>
            
            <NavItem path="/real-time-updates" icon={<Activity className="mr-3 h-5 w-5" />}>
              Real-Time Updates
            </NavItem>
            
            <NavItem path="/image-recognition" icon={<Camera className="mr-3 h-5 w-5" />}>
              Image Recognition
            </NavItem>
            
            <NavItem path="/document-extractor" icon={<FileUp className="mr-3 h-5 w-5" />}>
              Document Extractor
            </NavItem>
            
            <NavItem path="/settings" icon={<Settings className="mr-3 h-5 w-5" />}>
              Settings
            </NavItem>
          </div>
        </nav>
        
        <div className="p-4 border-t border-neutral-200 dark:border-neutral-700">
          <Button
            variant="ghost"
            className="w-full justify-start"
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
