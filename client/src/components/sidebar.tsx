import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import {
  Briefcase,
  Home,
  Map,
  MessageSquare,
  Moon,
  Settings,
  Star,
  Sun,
  User,
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
    return location === path;
  };

  const NavItem = ({ path, icon, children }: { path: string; icon: React.ReactNode; children: React.ReactNode }) => {
    return (
      <Link href={path}>
        <div
          className={cn(
            "flex items-center px-4 py-2.5 text-sm font-medium rounded-md cursor-pointer",
            isActive(path)
              ? "bg-primary text-white hover:bg-primary/90"
              : "text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-700",
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
      {open && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 shadow-sm transition-transform duration-200 transform md:translate-x-0 md:static md:z-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Map className="h-5 w-5" />
              </div>
              <div className="ml-2">
                <h1 className="text-lg font-semibold text-primary dark:text-white">SkillRadius</h1>
                <p className="text-xs text-muted-foreground">Local freelancer network</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 px-2 py-4 overflow-y-auto">
          <div className="space-y-2">
            <NavItem path="/" icon={<Home className="mr-3 h-5 w-5" />}>
              Home
            </NavItem>

            <NavItem path="/discover" icon={<Map className="mr-3 h-5 w-5" />}>
              Discover
            </NavItem>

            <NavItem path="/jobs" icon={<Briefcase className="mr-3 h-5 w-5" />}>
              Jobs
            </NavItem>

            <NavItem path="/messages" icon={<MessageSquare className="mr-3 h-5 w-5" />}>
              Messages
            </NavItem>

            <NavItem path="/reviews" icon={<Star className="mr-3 h-5 w-5" />}>
              Reviews
            </NavItem>

            <NavItem path="/profile" icon={<User className="mr-3 h-5 w-5" />}>
              Profile
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
