import React, { useState } from "react";
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
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useFallbackState } from "@/hooks/use-fallback-state";
import { Command as CommandPaletteIcon, LogOut, User, Settings, Bell, Moon, Palette, Search, Sun } from "lucide-react";
import { requestOpenCommandPalette } from "@/components/command-menu";
import { useTheme } from "@/components/theme-provider";
import { useAccent } from "@/components/accent-provider";
import { queryClient, requestJson } from "@/lib/queryClient";

type Notification = {
  id: number;
  title: string;
  body: string | null;
  type: string;
  readAt: string | null;
  createdAt: string;
};

export const Header: React.FC = () => {
  const [location, setLocation] = useLocation();
  const [searchInput, setSearchInput] = useState("");
  const { user, logoutMutation } = useAuth();
  const { theme, setTheme } = useTheme();
  const { accent, cycleAccent } = useAccent();
  const { badge: systemBadge } = useFallbackState();
  const environmentLabel = import.meta.env.DEV ? "DEV" : "PROD";
  const roleLabel = user?.role ? user.role.toUpperCase() : "GUEST";

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) {
      setLocation(`/inventory?q=${encodeURIComponent(q)}`);
    }
  };
  const permissionSummaryByRole: Record<string, string> = {
    admin: "Full access",
    manager: "Planner privileges",
    warehouse_staff: "Warehouse operations",
    viewer: "Read only",
  };
  const permissionSummary =
    permissionSummaryByRole[(user?.role || "viewer").toLowerCase()] || "Custom role";
  const { data: notifications = [] } = useQuery({
    queryKey: ["/api/notifications"],
    queryFn: () => requestJson<Notification[]>("GET", "/api/notifications"),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const markRead = useMutation({
    mutationFn: (id: number) => requestJson("POST", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
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
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <header className="topbar-glass h-16 px-4 border-b border-border sticky top-0 z-30 flex items-center justify-between">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-xs text-muted-foreground truncate">{breadcrumb || "Overview"}</p>
        <form className="relative mt-1 max-w-md" onSubmit={handleSearchSubmit}>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Global search"
            placeholder="Search SKU, supplier, PO, shipment..."
            className="h-9 pl-8"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
      </div>
      <div className="flex items-center space-x-2 md:space-x-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden gap-1.5 md:inline-flex shrink-0"
          onClick={() => requestOpenCommandPalette()}
          title="Open command palette"
        >
          <CommandPaletteIcon className="h-4 w-4" />
          <span className="text-xs font-medium">Jump to…</span>
          <kbd className="pointer-events-none hidden lg:inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ⌘K
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
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
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
              className="text-muted-foreground hover:text-foreground relative"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
                  {unreadCount}
                </span>
              ) : null}
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-80" align="end">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">No notifications yet.</div>
            ) : (
              notifications
                .slice()
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 8)
                .map((notification) => (
                  <DropdownMenuItem
                    key={notification.id}
                    className="flex flex-col items-start gap-1 py-2"
                    onClick={() => {
                      if (!notification.readAt) {
                        markRead.mutate(notification.id);
                      }
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-xs font-medium">{notification.title}</span>
                      {!notification.readAt ? (
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      ) : null}
                    </div>
                    {notification.body ? (
                      <span className="text-xs text-muted-foreground line-clamp-2">{notification.body}</span>
                    ) : null}
                  </DropdownMenuItem>
                ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              className="relative h-10 w-10 rounded-full border border-neutral-200 dark:border-neutral-700 p-0"
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
                <p className="text-[11px] leading-none text-muted-foreground pt-1">{permissionSummary}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Link href="/profile">
                  <div className="flex items-center">
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Link href="/settings">
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