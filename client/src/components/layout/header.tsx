import React, { useState } from "react";
import { Link, useLocation } from "wouter";
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
import { LogOut, User, Settings, Bell, Moon, Palette, Search, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAccent } from "@/components/accent-provider";

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
      <div className="flex items-center space-x-4">
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

        <Button 
          variant="ghost" 
          size="icon"
          className="text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
        </Button>

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