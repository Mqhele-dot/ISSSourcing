import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, ShoppingCart, User, Package } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeDate } from "@/lib/utils";
import { ActivityLog } from "@shared/schema";

export default function RecentActivity() {
  const { data: activityLogs, isLoading } = useQuery({
    queryKey: ["/api/activity-logs"],
    queryFn: async () => {
      const response = await fetch("/api/activity-logs?limit=3");
      if (!response.ok) {
        throw new Error("Failed to fetch activity logs");
      }
      return response.json() as Promise<ActivityLog[]>;
    },
  });

  if (isLoading) {
    return <ActivitySkeletons />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flow-root">
          <ul className="-mb-8">
            {activityLogs?.map((log, index) => (
              <li key={log.id}>
                <div className="relative pb-8">
                  {index !== activityLogs.length - 1 && (
                    <span
                      className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-neutral-200 dark:bg-neutral-700"
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative flex items-start space-x-3">
                    <div className="relative">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${getActivityIconClass(log.action)}`}>
                        {getActivityIcon(log.action)}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div>
                        <div className="text-sm font-medium text-neutral-900 dark:text-white">
                          {log.action}
                        </div>
                        <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                          {log.description}
                        </p>
                      </div>
                      <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        <span>{formatRelativeDate(log.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-700 px-5 py-3 rounded-b-lg">
        <Link href="/reports?section=activity">
          <a className="text-sm font-medium text-primary hover:text-primary/80 flex items-center">
            View all activity
            <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </Link>
      </CardFooter>
    </Card>
  );
}

// Helper function to get icon class based on activity type
function getActivityIconClass(action: string): string {
  if (action.toLowerCase().includes("order")) {
    return "bg-primary/10 dark:bg-primary/20 text-primary";
  } else if (action.toLowerCase().includes("supplier")) {
    return "bg-secondary/10 dark:bg-secondary/20 text-secondary";
  } else {
    return "bg-success/10 dark:bg-success/20 text-success";
  }
}

// Helper function to get icon based on activity type
function getActivityIcon(action: string) {
  if (action.toLowerCase().includes("order")) {
    return <ShoppingCart className="h-5 w-5" />;
  } else if (action.toLowerCase().includes("supplier")) {
    return <User className="h-5 w-5" />;
  } else {
    return <Package className="h-5 w-5" />;
  }
}

function ActivitySkeletons() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flow-root">
          <ul className="-mb-8">
            {[1, 2, 3].map((i, index) => (
              <li key={i}>
                <div className="relative pb-8">
                  {index !== 2 && (
                    <span
                      className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-neutral-200 dark:bg-neutral-700"
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative flex items-start space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-64" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-700 px-5 py-3 rounded-b-lg">
        <Skeleton className="h-4 w-24" />
      </CardFooter>
    </Card>
  );
}
