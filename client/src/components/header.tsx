import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Menu, Search, Bell, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";
import { useTheme } from "@/components/theme-provider";

type SearchResult = { type: string; id: string | number; title: string; subtitle: string; href: string };

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [, navigate] = useLocation();
  const { resolvedTheme, toggleTheme } = useTheme();
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250); return () => window.clearTimeout(timer); }, [searchQuery]);
  const search = useQuery({ queryKey: ["/api/v2/search", debouncedQuery], queryFn: () => requestJson<SearchResult[]>("GET", `/api/v2/search?q=${encodeURIComponent(debouncedQuery)}&limit=5`), enabled: debouncedQuery.length >= 2, retry: 1 });
  const results = search.data ?? [];
  const openResult = (result?: SearchResult) => { if (!result) return; navigate(result.href); setSearchQuery(""); setSearchOpen(false); };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    openResult(results[activeResult] ?? results[0]);
  };

  return (
    <header className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 shadow-sm z-10">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="ml-2 text-xl font-semibold text-primary dark:text-white md:hidden">ISSSourcing</h1>
        </div>
        
        <div className="flex-1 flex justify-center px-2 md:ml-6 md:justify-end">
          <form onSubmit={handleSearch} className="max-w-lg w-full relative" role="search">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-neutral-500" />
            </div>
            <Input
              type="search"
              className="block w-full pl-10 pr-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-md bg-neutral-100 dark:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm"
              aria-label="Global search" role="combobox" aria-expanded={searchOpen && searchQuery.trim().length >= 2} aria-controls="universal-search-results"
              placeholder="Search SKU, supplier, PO, requisition, RFQ..."
              value={searchQuery}
              onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); setActiveResult(0); }}
              onKeyDown={(event) => { if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setActiveResult((value) => (value + 1) % results.length); } if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActiveResult((value) => (value - 1 + results.length) % results.length); } if (event.key === "Escape") setSearchOpen(false); }}
            />
            {searchOpen && searchQuery.trim().length >= 2 ? <div id="universal-search-results" role="listbox" className="absolute left-0 right-0 top-11 z-50 max-h-96 overflow-auto rounded-md border bg-popover p-1 shadow-lg">{search.isLoading ? <p className="p-3 text-sm text-muted-foreground">Searching…</p> : null}{search.isError ? <div className="flex items-center justify-between p-3 text-sm"><span>Search unavailable.</span><Button type="button" size="sm" variant="outline" onMouseDown={(e) => e.preventDefault()} onClick={() => search.refetch()}>Retry</Button></div> : null}{!search.isLoading && !search.isError && !results.length ? <p className="p-3 text-sm text-muted-foreground">No permitted results found.</p> : null}{results.map((result, index) => <button key={`${result.type}:${result.id}`} type="button" role="option" aria-selected={index === activeResult} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveResult(index)} onClick={() => openResult(result)} className={`flex w-full justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm ${index === activeResult ? "bg-accent" : "hover:bg-accent/60"}`}><span><span className="block font-medium">{result.title}</span><span className="block text-xs text-muted-foreground">{result.subtitle}</span></span><span className="text-[10px] uppercase text-muted-foreground">{result.type}</span></button>)}</div> : null}
          </form>
        </div>
        
        <div className="flex items-center ml-4">
          <Button variant="ghost" size="icon" onClick={toggleTheme}>{resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}<span className="sr-only">Toggle theme</span></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-primary"
              >
                <Bell className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="p-2 font-medium">Notifications</div>
              <DropdownMenuSeparator />
              <div className="p-4 text-sm text-center text-neutral-500 dark:text-neutral-400">
                No new notifications
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <div className="ml-3 relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-600"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80" alt="User profile" />
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="p-2 font-medium">John Doe</div>
                <div className="p-2 text-sm text-neutral-500">admin@example.com</div>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
