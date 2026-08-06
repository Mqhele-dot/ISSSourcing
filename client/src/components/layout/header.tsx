import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useFallbackState } from "@/hooks/use-fallback-state";
import { Command as CommandPaletteIcon, LogOut, User, Settings, Bell, Moon, Palette, Search, Sun } from "lucide-react";
import { requestOpenCommandPalette } from "@/components/command-menu";
import { useTheme } from "@/components/theme-provider";
import { useAccent } from "@/components/accent-provider";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { qk } from "@/lib/query-keys";
import { queryClient, requestJson } from "@/lib/queryClient";
import { getGlobalSearchTypeLabel } from "@/features/global-search/use-global-search";
import { notificationTarget } from "@/lib/notifications/notification-target";

type Notification = {
  id: number;
  title: string;
  body: string | null;
  type: string;
  readAt: string | null;
  createdAt: string;
  lastOccurredAt: string;
  occurrenceCount: number;
  entityType: string | null;
  entityId: number | null;
};

type NotificationResponse = {
  items: Notification[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};

type UniversalSearchResult = {
  type: "inventory" | "supplier" | "purchase-order" | "requisition" | "rfq" | "shipment" | "exception";
  id: number | string;
  title: string;
  subtitle: string;
  status: string | null;
  href: string;
};

export const Header: React.FC = () => {
  const [location, setLocation] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const { user, logoutMutation } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { accent, cycleAccent } = useAccent();
  const { badge: systemBadge } = useFallbackState();
  const environmentLabel = import.meta.env.DEV ? "DEV" : "PROD";
  const roleLabel = user?.role ? user.role.toUpperCase() : "GUEST";

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const universalSearch = useQuery({
    queryKey: ["/api/v2/search", searchQuery],
    queryFn: () =>
      requestJson<UniversalSearchResult[]>(
        "GET",
        `/api/v2/search?q=${encodeURIComponent(searchQuery)}&limit=5`,
      ),
    enabled: !!user && searchQuery.length >= 2,
    retry: 1,
  });
  const searchResults = universalSearch.data ?? [];

  const navigateToResult = (result?: UniversalSearchResult) => {
    if (!result) return;
    setSearchOpen(false);
    setSearchInput("");
    setSearchQuery("");
    setActiveResult(0);
    setLocation(result.href);
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    navigateToResult(searchResults[activeResult] ?? searchResults[0]);
  };

  const permissionSummaryByRole: Record<string, string> = {
    admin: "Full access",
    manager: "Planner privileges",
    warehouse_staff: "Warehouse operations",
    viewer: "Read only",
  };
  const permissionSummary =
    permissionSummaryByRole[(user?.role || "viewer").toLowerCase()] || "Custom role";
  const { data: notificationPage } = useQuery({
    queryKey: [...qk.notifications, "recent"],
    queryFn: () => requestJson<NotificationResponse>("GET", "/api/notifications?page=1&pageSize=8"),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const notifications = notificationPage?.items ?? [];
  const unreadCount = notificationPage?.unreadCount ?? 0;
  const markRead = useMutation({
    mutationFn: (id: number) => requestJson("POST", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.notifications });
    },
  });
  const markAllRead = useMutation({
    mutationFn: () => requestJson("POST", "/api/notifications/mark-all-read"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });

  const breadcrumb = location
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/-/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <header className="topbar-glass sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border px-4 pl-14 md:pl-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:gap-4 md:pr-2">
        <p className="order-1 max-w-full truncate text-xs text-muted-foreground md:order-none md:max-w-[min(28rem,40vw)]">
          {breadcrumb || "Overview"}
        </p>
        <form className="relative order-2 w-full max-w-md md:order-none" onSubmit={handleSearchSubmit} role="search">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Global search"
            data-testid="global-search-input"
            placeholder="Search SKU, supplier, PO, requisition, RFQ..."
            className="h-9 pl-8"
            value={searchInput}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen && searchInput.trim().length >= 2}
            aria-controls="universal-search-results"
            onFocus={() => setSearchOpen(searchInput.trim().length >= 2)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
            onChange={(e) => {
              const next = e.target.value;
              setSearchInput(next);
              setSearchOpen(next.trim().length >= 2);
              setActiveResult(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && searchResults.length) {
                e.preventDefault();
                setActiveResult((value) => (value + 1) % searchResults.length);
              }
              if (e.key === "ArrowUp" && searchResults.length) {
                e.preventDefault();
                setActiveResult((value) => (value - 1 + searchResults.length) % searchResults.length);
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
              }
            }}
          />
          {searchOpen && searchInput.trim().length >= 2 ? (
            <div
              id="universal-search-results"
              role="listbox"
              className="absolute left-0 right-0 top-10 z-50 max-h-96 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
              data-testid="global-search-results"
            >
              {universalSearch.isLoading ? (
                <p className="p-3 text-sm text-muted-foreground" data-testid="global-search-loading">
                  Searching...
                </p>
              ) : null}
              {universalSearch.isError ? (
                <div className="flex items-center justify-between gap-2 p-3 text-sm" data-testid="global-search-error">
                  <span>Search is temporarily unavailable.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => universalSearch.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              {!universalSearch.isLoading && !universalSearch.isError && searchResults.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground" data-testid="global-search-empty">
                  No permitted results found.
                </p>
              ) : null}
              {searchResults.map((result, index) => (
                <button
                  key={`${result.type}:${result.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeResult}
                  className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm ${index === activeResult ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                  data-testid={`global-search-result-${result.type}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveResult(index)}
                  onClick={() => navigateToResult(result)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{result.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                    {getGlobalSearchTypeLabel(result.type)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </div>
      <div className="flex items-center space-x-2 md:space-x-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden shrink-0 gap-1.5 md:inline-flex"
          onClick={() => requestOpenCommandPalette()}
          title="Open command palette"
        >
          <CommandPaletteIcon className="h-4 w-4" />
          <span className="text-xs font-medium">Jump to...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline-flex">
            Ctrl+K
          </kbd>
        </Button>
        <Badge
          variant={systemBadge === "DEGRADED" ? "destructive" : "outline"}
          className="hidden md:inline-flex"
          title={systemBadge === "DEGRADED" ? "Operational data is in degraded mode" : "System status"}
        >
          {systemBadge}
        </Badge>
        <Badge variant="outline" className="hidden md:inline-flex">
          {environmentLabel}
        </Badge>
        <Badge variant="secondary" className="hidden md:inline-flex">
          {roleLabel}
        </Badge>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={toggleTheme}
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={cycleAccent}
          title={`Accent: ${accent}`}
        >
          <Palette className="h-5 w-5" />
          <span className="sr-only">Cycle accent palette</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-80" align="end">
            <DropdownMenuLabel className="flex items-center justify-between gap-3">
              <span>Notifications</span>
              {unreadCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={markAllRead.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    markAllRead.mutate();
                  }}
                >
                  Mark all read
                </Button>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">No notifications yet.</div>
            ) : (
              notifications
                .slice()
                .map((notification) => (
                  <DropdownMenuItem
                    key={notification.id}
                    className="flex flex-col items-start gap-1 py-2"
                    onClick={() => {
                      if (!notification.readAt) {
                        markRead.mutate(notification.id);
                      }
                      setLocation(notificationTarget(notification));
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        {notification.title}
                        {notification.occurrenceCount > 1 ? ` (${notification.occurrenceCount})` : ""}
                      </span>
                      {!notification.readAt ? (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      ) : null}
                    </div>
                    {notification.body ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</span>
                    ) : null}
                    <span className="text-[11px] font-medium text-primary">Open related workspace</span>
                  </DropdownMenuItem>
                ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-10 w-10 rounded-full border border-neutral-200 p-0 dark:border-neutral-700"
            >
              <Avatar>
                <AvatarImage src={user?.profilePicture || ""} alt={user?.username || "User"} />
                <AvatarFallback>{user?.fullName ? getInitials(user.fullName) : getInitials(user?.username || "User")}</AvatarFallback>
              </Avatar>
              <span className="sr-only">Open user menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.fullName || user?.username}</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                <p className="pt-1 text-[11px] leading-none text-muted-foreground">{permissionSummary}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Link href={APP_ROUTES.admin.profile}>
                  <div className="flex items-center">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href={APP_ROUTES.admin.settings}>
                  <div className="flex items-center">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </div>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
