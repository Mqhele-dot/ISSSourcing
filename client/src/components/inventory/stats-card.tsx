import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconClassName: string;
  link: {
    href: string;
    label: string;
  };
  loading?: boolean;
}

export function StatsCard({
  title,
  value,
  icon,
  iconClassName,
  link,
  loading = false,
}: StatsCardProps) {
  return (
    <Card className="overflow-hidden shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center">
          <div className={cn("flex-shrink-0 rounded-md p-3", iconClassName)}>
            {icon}
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="truncate text-sm font-medium text-neutral-500 dark:text-neutral-400">
                {title}
              </dt>
              <dd>
                {loading ? (
                  <Skeleton className="h-7 w-20 mt-1" />
                ) : (
                  <div className="text-lg font-semibold text-neutral-900 dark:text-white">
                    {value}
                  </div>
                )}
              </dd>
            </dl>
          </div>
        </div>
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-700 px-5 py-3">
        <div className="text-sm">
          <Link href={link.href}>
            <a className="font-medium text-primary hover:text-primary/80 flex items-center">
              {link.label}
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
