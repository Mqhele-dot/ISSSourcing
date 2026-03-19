import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  Archive,
  BarChart2,
  Building,
  Camera,
  Command as CommandIcon,
  Database,
  FileText,
  FileUp,
  Home,
  LayoutDashboard,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  ShoppingCart,
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
import { invTrackFetch, queryClient } from "@/lib/queryClient";

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

const SECTIONS: { heading: string; items: NavEntry[] }[] = [
  {
    heading: "Control Tower",
    items: [
      { label: "Home", path: "/", keywords: "landing overview", icon: <Home className="h-4 w-4" /> },
      { label: "Dashboard", path: "/dashboard", keywords: "kpi metrics", icon: <LayoutDashboard className="h-4 w-4" /> },
      { label: "Analytics", path: "/analytics", keywords: "charts graphs", icon: <BarChart2 className="h-4 w-4" /> },
    ],
  },
  {
    heading: "Master Data",
    items: [
      { label: "Inventory", path: "/inventory", keywords: "sku stock items", icon: <Archive className="h-4 w-4" /> },
      { label: "Master Data", path: "/master-data", keywords: "uom currency tax", icon: <Database className="h-4 w-4" /> },
      { label: "Suppliers", path: "/suppliers", keywords: "vendors", icon: <Users className="h-4 w-4" /> },
      { label: "Warehouses", path: "/warehouses", keywords: "locations bins", icon: <Building className="h-4 w-4" /> },
      { label: "Barcode Scanner", path: "/barcode-scanner", keywords: "qr scan", icon: <QrCode className="h-4 w-4" /> },
      { label: "Image Recognition", path: "/image-recognition", keywords: "vision ocr", icon: <Camera className="h-4 w-4" /> },
    ],
  },
  {
    heading: "Procurement",
    items: [
      { label: "Purchase Orders", path: "/purchase", keywords: "po orders", icon: <ShoppingCart className="h-4 w-4" /> },
      { label: "Requisitions", path: "/purchase/requisitions", keywords: "req approval", icon: <FileText className="h-4 w-4" /> },
      { label: "Invoices", path: "/invoices", keywords: "ap three-way match", icon: <FileText className="h-4 w-4" /> },
      { label: "Supplier Portal", path: "/supplier-portal", keywords: "vendor", icon: <Users className="h-4 w-4" /> },
    ],
  },
  {
    heading: "Operations",
    items: [
      { label: "Cycle Counts", path: "/cycle-counts", keywords: "physical count", icon: <RefreshCw className="h-4 w-4" /> },
      { label: "Reorder Requests", path: "/reorder", keywords: "rop", icon: <RefreshCw className="h-4 w-4" /> },
      { label: "Shipments", path: "/logistics", keywords: "carrier tracking", icon: <Building className="h-4 w-4" /> },
    ],
  },
  {
    heading: "Finance & compliance",
    items: [
      { label: "Payments & Billing", path: "/billing", keywords: "payments", icon: <FileText className="h-4 w-4" /> },
      { label: "Contracts", path: "/contracts", keywords: "legal", icon: <FileText className="h-4 w-4" /> },
      { label: "Audit Logs", path: "/audit-logs", keywords: "compliance sox", icon: <Activity className="h-4 w-4" /> },
      { label: "Documents", path: "/documents", keywords: "attachments", icon: <FileUp className="h-4 w-4" /> },
      { label: "Exceptions", path: "/exceptions", keywords: "issues", icon: <Activity className="h-4 w-4" /> },
    ],
  },
  {
    heading: "Analytics & tools",
    items: [
      { label: "Reports", path: "/reports", keywords: "export pdf excel", icon: <FileText className="h-4 w-4" /> },
      { label: "Supply Analytics", path: "/supply-analytics", keywords: "spend utilization", icon: <BarChart2 className="h-4 w-4" /> },
      { label: "Connectors", path: "/integrations", keywords: "api integration", icon: <FileUp className="h-4 w-4" /> },
      { label: "Document Extractor", path: "/document-extractor", keywords: "parse invoice", icon: <FileUp className="h-4 w-4" /> },
      { label: "Employee Profiles", path: "/employee-profiles", keywords: "hr users", icon: <Users className="h-4 w-4" /> },
      { label: "Settings", path: "/settings", keywords: "preferences security", icon: <Settings className="h-4 w-4" /> },
      { label: "Profile", path: "/profile", keywords: "account me", icon: <Users className="h-4 w-4" /> },
      { label: "User roles", path: "/user-roles", keywords: "rbac permissions", icon: <Users className="h-4 w-4" /> },
      { label: "Downloads", path: "/download", keywords: "export files", icon: <FileUp className="h-4 w-4" /> },
    ],
  },
];

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
        {SECTIONS.map((section) => (
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
