import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  APP_NAV_SECTIONS,
  NAV_DESKTOP_ONLY_PATHS,
  SIDEBAR_ADMIN_SECONDARY_GROUPS,
  sidebarAdminSubgroupLabel,
} from "@/lib/routes/section-metadata";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { useTheme } from "@/components/theme-provider";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/use-auth";
import { hasProfileNavigationAccess } from "@/lib/access/profile-navigation-access";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  BarChart2,
  Bookmark,
  Building,
  Camera,
  ClipboardList,
  CreditCard,
  Database,
  FileSpreadsheet,
  FolderOpen,
  Fuel,
  GraduationCap,
  Home,
  IdCard,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  Moon,
  PackagePlus,
  PackageSearch,
  Plug,
  QrCode,
  Radar,
  Receipt,
  RefreshCw,
  ScanSearch,
  Scale,
  ScrollText,
  ChevronsLeft,
  ChevronsRight,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Store,
  Sun,
  Truck,
  UserRound,
  Users,
  X,
} from "lucide-react";

interface SidebarProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Desktop (md+): icon rail when true */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export default function Sidebar({ open, setOpen, collapsed, setCollapsed }: SidebarProps) {
  const [location] = useLocation();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const isDesktopNav = useMediaQuery("(min-width: 1024px)");
  const { data: releaseScope } = useQuery<{
    boundary: "procurement" | "full";
    productionRuntime: boolean;
    previewMode: boolean;
    modules: Record<string, boolean>;
  }>({
    queryKey: ["/api/release-scope"],
    queryFn: () => requestJson("GET", "/api/release-scope"),
    staleTime: 5 * 60_000,
  });

  const iconMap = {
    activity: Activity,
    "alert-triangle": AlertTriangle,
    archive: Archive,
    "arrow-down-to-line": ArrowDownToLine,
    "bar-chart-2": BarChart2,
    bookmark: Bookmark,
    building: Building,
    camera: Camera,
    "clipboard-list": ClipboardList,
    "credit-card": CreditCard,
    database: Database,
    download: ArrowDownToLine,
    "file-spreadsheet": FileSpreadsheet,
    "folder-open": FolderOpen,
    fuel: Fuel,
    "graduation-cap": GraduationCap,
    home: Home,
    "id-card": IdCard,
    landmark: Landmark,
    "layout-dashboard": LayoutDashboard,
    "list-ordered": ListOrdered,
    "package-search": PackageSearch,
    plug: Plug,
    "qr-code": QrCode,
    radar: Radar,
    receipt: Receipt,
    "refresh-cw": RefreshCw,
    "scan-search": ScanSearch,
    scale: Scale,
    "scroll-text": ScrollText,
    settings: Settings,
    "shield-check": ShieldCheck,
    "shopping-cart": ShoppingCart,
    smartphone: Smartphone,
    store: Store,
    truck: Truck,
    "user-round": UserRound,
    users: Users,
  } as const;

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
    dataTestId,
  }: {
    path: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    helpTitle?: string;
    helpDescription?: string;
    dataTestId?: string;
  }) => {
    const label = typeof children === "string" ? children : helpTitle ?? "";
    return (
      <Link href={path} title={collapsed ? label : undefined} onClick={() => setOpen(false)}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-md cursor-pointer transition-all",
            collapsed ? "md:justify-center md:px-2 md:py-2.5" : "px-4 py-2.5",
            isActive(path)
              ? "accent-gradient-bg text-primary-foreground elev-2"
              : "text-foreground hover:bg-muted"
          )}
          {...(dataTestId ? { "data-testid": dataTestId } : {})}
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
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium text-inherit",
              collapsed && "md:sr-only",
            )}
            title={!collapsed ? (helpTitle ?? (typeof children === "string" ? children : undefined)) : undefined}
          >
            {children}
          </span>
        </div>
      </Link>
    );
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p
      className={cn(
        "px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        collapsed && "md:hidden",
      )}
    >
      {children}
    </p>
  );

  const NavSubSectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p
      className={cn(
        "px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/90",
        collapsed && "md:hidden",
      )}
    >
      {children}
    </p>
  );

  const showNavPath = (path: string, desktopOnly?: boolean) =>
    (isDesktopNav || (!NAV_DESKTOP_ONLY_PATHS.has(path) && !desktopOnly)) &&
    hasProfileNavigationAccess(user?.role, user?.preferences as { allowedNavPaths?: string[] } | null, path);

  const productionAreaForSection = (key: string): string | null => {
    if (key === "operations") return "logistics";
    if (key === "inventory") return "inventory";
    if (key === "finance") return "finance";
    return null;
  };

  const showSection = (key: string) => {
    const area = productionAreaForSection(key);
    return !area || releaseScope?.modules?.[area] !== false;
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
        data-testid="sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full max-h-svh w-64 max-w-[85vw] flex-col overflow-hidden bg-card border-r border-border shadow-[var(--shadow-elev-1)] accent-glow transition-[transform,width] duration-200 ease-out transform md:translate-x-0 md:static md:z-0 md:h-svh md:max-h-svh md:max-w-none md:shrink-0",
          open ? "translate-x-0" : "-translate-x-full",
          collapsed ? "md:w-[4.25rem] md:min-w-[4.25rem]" : "md:w-64 md:min-w-[16rem]",
        )}
      >
        <div className="p-3 md:p-4 border-b border-border">
          <div className="flex items-center justify-between gap-1">
            <div className={cn("flex min-w-0 items-center", collapsed && "md:justify-center md:w-full")}>
              <svg className="h-8 w-8 shrink-0 text-primary" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 18H4V6H20V18Z" />
                <path d="M6 14H18V16H6V14Z" />
                <path d="M6 11H18V13H6V11Z" />
                <path d="M6 8H18V10H6V8Z" />
              </svg>
              <h1
                className={cn(
                  "ml-2 truncate text-xl font-semibold text-primary",
                  collapsed && "md:sr-only",
                )}
              >
                ISSSourcing
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden md:inline-flex"
                aria-label={collapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
        
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-4">
          <div className="space-y-1">
            {/* Order mirrors `APP_NAV_SECTIONS`; "Learning" / Get Educated is the final section. */}
            {APP_NAV_SECTIONS.filter((section) => showSection(section.key)).map((section) => (
              <div key={section.key}>
                <SectionTitle>{section.label}</SectionTitle>
                {section.items
                  .filter(
                    (item) =>
                      !item.hiddenFromPrimaryNav && showNavPath(item.path, item.desktopOnly),
                  )
                  .map((item) => {
                    const Icon = iconMap[item.icon as keyof typeof iconMap];
                    if (!Icon) return null;
                    return (
                      <NavItem
                        key={item.path}
                        path={item.path}
                        icon={<Icon className="h-5 w-5" />}
                        helpTitle={item.label}
                        helpDescription={item.description}
                        dataTestId={
                          item.path === APP_ROUTES.training.getEducated ? "sidebar-get-educated" : undefined
                        }
                      >
                        {item.label}{releaseScope?.previewMode && productionAreaForSection(section.key) ? " (Preview)" : ""}
                      </NavItem>
                    );
                  })}
                {section.key === "admin" &&
                  SIDEBAR_ADMIN_SECONDARY_GROUPS.map((group) => (
                    <div key={group.heading} className="space-y-0">
                      <NavSubSectionTitle>{sidebarAdminSubgroupLabel(group.heading)}</NavSubSectionTitle>
                      {group.items
                        .filter((item) => showNavPath(item.path, item.desktopOnly))
                        .map((item) => {
                          const Icon = iconMap[item.icon as keyof typeof iconMap];
                          if (!Icon) return null;
                          return (
                            <NavItem
                              key={item.path}
                              path={item.path}
                              icon={<Icon className="h-5 w-5" />}
                              helpTitle={item.label}
                              helpDescription={item.description}
                            >
                              {item.label}
                            </NavItem>
                          );
                        })}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </nav>

        <div className="p-3 md:p-4 border-t border-border">
          <Button
            variant="ghost"
            className={cn(
              "w-full",
              collapsed ? "md:justify-center md:px-0" : "justify-start",
            )}
            title={collapsed ? "Theme" : undefined}
            data-help-title="Theme toggle"
            data-help-description="Switch between light and dark mode."
                onClick={toggleTheme}
          >
            {resolvedTheme === "dark" ? (
              <>
                <Sun className={cn("h-5 w-5", !collapsed && "mr-2")} />
                <span className={cn(collapsed && "md:sr-only")}>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className={cn("h-5 w-5", !collapsed && "mr-2")} />
                <span className={cn(collapsed && "md:sr-only")}>Dark Mode</span>
              </>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
