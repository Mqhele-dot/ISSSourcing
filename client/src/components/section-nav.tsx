import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

type SectionNavItem = {
  label: string;
  href: string;
};

export function SectionNav({
  items,
  className,
}: {
  items: SectionNavItem[];
  className?: string;
}) {
  const [location] = useLocation();

  return (
    <nav
      className={cn(
        "flex w-full max-w-full flex-nowrap gap-2 overflow-x-auto rounded-lg border bg-card p-2",
        className,
      )}
      aria-label="Section navigation"
    >
      {items.map((item) => {
        const active = location === item.href || location.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
