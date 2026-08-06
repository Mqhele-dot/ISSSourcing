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
  Fuel,
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
import {
  COMMAND_MENU_SECONDARY_GROUPS,
  APP_NAV_SECTIONS,
  NAV_DESKTOP_ONLY_PATHS,
} from "@/lib/routes/section-metadata";
import { invTrackFetch, queryClient } from "@/lib/queryClient";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getGlobalSearchTypeLabel, useGlobalSearch } from "@/features/global-search/use-global-search";
import { useAuth } from "@/hooks/use-auth";
import { hasProfileNavigationAccess } from "@/lib/access/profile-navigation-access";

export const OPEN_COMMAND_PALETTE_EVENT = "invtrack:open-command-palette";

export function requestOpenCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}

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
  fuel: <Fuel className="h-4 w-4" />,
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

function prefetchPrimaryData(): void {
  const warm: { queryKey: string[] }[] = [
    { queryKey: ["/api/inventory"] },
    { queryKey: ["/api/suppliers"] },
    { queryKey: ["/api/procurement/purchase-orders/records"] },
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
        /* ignore */
      });
  }
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [, navigate] = useLocation();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { user } = useAuth();
  const globalSearch = useGlobalSearch(searchInput, { limit: 5, enabled: open });
  const trimmedSearch = searchInput.trim();
  const globalResults = (globalSearch.data ?? []).filter((result) =>
    hasProfileNavigationAccess(user?.role, user?.preferences as { allowedNavPaths?: string[] } | null, result.href),
  );

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
    const merged = [...primary, ...secondary].map((section) => ({
      ...section,
      items: section.items.filter((item) => hasProfileNavigationAccess(user?.role, user?.preferences as { allowedNavPaths?: string[] } | null, item.path)),
    }));
    if (isDesktop) return merged;
    return merged.map((section) => ({
      ...section,
      items: section.items.filter((item) => !NAV_DESKTOP_ONLY_PATHS.has(item.path) && !item.desktopOnly),
    }));
  }, [isDesktop, user?.preferences, user?.role]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
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
    if (!next) setSearchInput("");
  }, []);

  const run = useCallback(
    (path: string) => {
      setOpen(false);
      setSearchInput("");
      navigate(path);
    },
    [navigate],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search records or jump to module..."
        value={searchInput}
        onValueChange={setSearchInput}
      />
      <CommandList>
        <CommandEmpty>No matching destination.</CommandEmpty>
        {trimmedSearch.length >= 2 ? (
          <CommandGroup heading="Global Search">
            {globalSearch.isLoading ? (
              <CommandItem disabled value={`${trimmedSearch} loading`}>
                <Search className="h-4 w-4" />
                <span className="ml-2">Searching records...</span>
              </CommandItem>
            ) : globalSearch.isError ? (
              <CommandItem disabled value={`${trimmedSearch} error`}>
                <AlertTriangle className="h-4 w-4" />
                <span className="ml-2">Global search is temporarily unavailable</span>
              </CommandItem>
            ) : globalResults.length === 0 ? (
              <CommandItem disabled value={`${trimmedSearch} no results`}>
                <Search className="h-4 w-4" />
                <span className="ml-2">No matching records</span>
              </CommandItem>
            ) : (
              globalResults.map((result) => (
                <CommandItem
                  key={`${result.type}:${result.id}`}
                  value={`${result.title} ${result.subtitle} ${result.status ?? ""} ${getGlobalSearchTypeLabel(result.type)}`}
                  onSelect={() => run(result.href)}
                >
                  <Search className="h-4 w-4" />
                  <span className="ml-2">{result.title}</span>
                  <CommandShortcut>{getGlobalSearchTypeLabel(result.type)}</CommandShortcut>
                </CommandItem>
              ))
            )}
          </CommandGroup>
        ) : null}
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
                <CommandShortcut className="hidden sm:inline">Enter</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Shortcuts">
          {hasProfileNavigationAccess(user?.role, user?.preferences as { allowedNavPaths?: string[] } | null, "/inventory") ? <CommandItem onSelect={() => run("/inventory")}>
            <Search className="h-4 w-4" />
            <span className="ml-2">Inventory search hub</span>
          </CommandItem> : null}
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
