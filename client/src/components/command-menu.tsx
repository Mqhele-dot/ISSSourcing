import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  Bookmark,
  Building,
  Camera,
  ClipboardList,
  Command as CommandIcon,
  CreditCard,
  Database,
  FileText,
  FileUp,
  FolderOpen,
  Home,
  IdCard,
  Landmark,
  LayoutDashboard,
  PackageSearch,
  Plug,
  QrCode,
  Radar,
  RefreshCw,
  Receipt,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Store,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { COMMAND_MENU_SECONDARY_GROUPS, APP_NAV_SECTIONS } from "@/lib/routes/section-metadata";
import { invTrackFetch, queryClient } from "@/lib/queryClient";
import { useMediaQuery } from "@/hooks/use-media-query";

/** Dispatched to open the palette from header or other chrome without prop drilling. */
export const OPEN_COMMAND_PALETTE_EVENT = "invtrack:open-command-palette";

export function requestOpenCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}

type NavEntry = {
  label: string;
  path: string;
  keywords?: string;
  icon: React.ReactNode;
};

const ICONS = {
  activity: <Activity className="h-4 w-4" />,
  "alert-triangle": <AlertTriangle className="h-4 w-4" />,
  archive: <Archive className="h-4 w-4" />,
  "arrow-down-to-line": <ArrowDownToLine className="h-4 w-4" />,
  bookmark: <Bookmark className="h-4 w-4" />,
  building: <Building className="h-4 w-4" />,
  camera: <Camera className="h-4 w-4" />,
  "clipboard-list": <ClipboardList className="h-4 w-4" />,
  "credit-card": <CreditCard className="h-4 w-4" />,
  database: <Database className="h-4 w-4" />,
  download: <ArrowDownToLine className="h-4 w-4" />,
  "file-spreadsheet": <FileText className="h-4 w-4" />,
  "folder-open": <FolderOpen className="h-4 w-4" />,
  home: <Home className="h-4 w-4" />,
  "id-card": <IdCard className="h-4 w-4" />,
  landmark: <Landmark className="h-4 w-4" />,
  "layout-dashboard": <LayoutDashboard className="h-4 w-4" />,
  "package-search": <PackageSearch className="h-4 w-4" />,
  plug: <Plug className="h-4 w-4" />,
  "qr-code": <QrCode className="h-4 w-4" />,
  radar: <Radar className="h-4 w-4" />,
  receipt: <Receipt className="h-4 w-4" />,
  "refresh-cw": <RefreshCw className="h-4 w-4" />,
  "scan-search": <ScanSearch className="h-4 w-4" />,
  settings: <Settings className="h-4 w-4" />,
  "shield-check": <ShieldCheck className="h-4 w-4" />,
  "shopping-cart": <ShoppingCart className="h-4 w-4" />,
  smartphone: <Smartphone className="h-4 w-4" />,
  store: <Store className="h-4 w-4" />,
  truck: <Truck className="h-4 w-4" />,
  "user-round": <UserRound className="h-4 w-4" />,
  users: <Users className="h-4 w-4" />,
} as const;

/** Hidden from command palette below `lg` (1024px), same as sidebar / route guards. */
const DESKTOP_ONLY_PATHS = new Set([
  "/admin/master-data",
  "/finance/approval-policies",
  "/admin/employee-profiles",
]);

/** Warm cache for high-traffic lists when user opens the palette (enterprise “feel”). */
function prefetchPrimaryData(): void {
  const warm: { queryKey: string[] }[] = [
    { queryKey: ["/api/inventory"] },
    { queryKey: ["/api/suppliers"] },
    { queryKey: ["/api/purchase-orders"] },
    { queryKey: ["/api/warehouses"] },
  ];
  for (const { queryKey } of warm) {
    void queryClient
      .prefetchQuery({
        queryKey,
        queryFn: async () => {
          const { data } = await invTrackFetch<unknown>("GET", queryKey[0] as string);
          return data;
        },
        staleTime: 60_000,
      })
      .catch(() => {
        /* ignore — session or RBAC may block prefetch */
      });
  }
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  /** Match master-data and other wide-layout admin pages (lg+). */
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const sections = useMemo(() => {
    const mapItem = (item: (typeof APP_NAV_SECTIONS)[number]["items"][number]) => ({
      label: item.label,
      path: item.path,
      keywords: item.keywords,
      icon: ICONS[item.icon as keyof typeof ICONS] ?? <FileUp className="h-4 w-4" />,
      desktopOnly: item.desktopOnly,
    });
    const primary = APP_NAV_SECTIONS.map((section) => ({
      heading: section.label,
      items: section.items.filter((item) => !item.hiddenFromPrimaryNav).map(mapItem),
    }));
    const secondary = COMMAND_MENU_SECONDARY_GROUPS.map((group) => ({
      heading: group.heading,
      items: group.items.map(mapItem),
    }));
    const merged = [...primary, ...secondary];
    if (isDesktop) return merged;
    return merged.map((section) => ({
      ...section,
      items: section.items.filter((item) => !DESKTOP_ONLY_PATHS.has(item.path) && !item.desktopOnly),
    }));
  }, [isDesktop]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    const onOpen = () => {
      prefetchPrimaryData();
      setOpen(true);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
  }, []);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) prefetchPrimaryData();
  }, []);

  const run = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to module… (try “req”, “invoice”, “warehouse”)" />
      <CommandList>
        <CommandEmpty>No matching destination.</CommandEmpty>
        {sections.map((section) => (
          <CommandGroup key={section.heading} heading={section.heading}>
            {section.items.map((item) => (
              <CommandItem
                key={item.path}
                value={`${item.label} ${item.path} ${item.keywords ?? ""}`}
                onSelect={() => run(item.path)}
              >
                {item.icon}
                <span className="ml-2">{item.label}</span>
                <CommandShortcut className="hidden sm:inline">↵</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Shortcuts">
          <CommandItem onSelect={() => run("/inventory")}>
            <Search className="h-4 w-4" />
            <span className="ml-2">Inventory search hub</span>
          </CommandItem>
          <CommandItem onSelect={() => setOpen(false)}>
            <CommandIcon className="h-4 w-4" />
            <span className="ml-2">Close</span>
            <CommandShortcut>Esc</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
