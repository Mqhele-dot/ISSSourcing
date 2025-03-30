import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { format } from 'date-fns';
import { useDateRangeParams } from '@/hooks/use-date-range-params';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { type InventoryItem } from '@shared/schema';

export function TopItems() {
  const [, setLocation] = useLocation();
  const { dateRange, updateDateRange, range, updateRange } = useDateRangeParams(30);

  // Build query parameters
  const queryParams = new URLSearchParams();
  queryParams.append("limit", "8"); // Show top 8 items
  
  if (dateRange?.from) {
    queryParams.append("startDate", format(dateRange.from, "yyyy-MM-dd"));
  }
  
  if (dateRange?.to) {
    queryParams.append("endDate", format(dateRange.to, "yyyy-MM-dd"));
  }

  // Fetch top items
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/analytics/top-items', queryParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/analytics/top-items?${queryParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch top items');
      }
      return response.json() as Promise<InventoryItem[]>;
    },
  });

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Items by Demand</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center p-6">
            <p className="text-destructive">Error loading top items data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
          <CardTitle>Top Items by Demand</CardTitle>
          <div className="mt-2 md:mt-0">
            <DateRangePicker
              date={dateRange}
              onDateChange={updateDateRange}
              className="w-[220px]"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-12 w-12 rounded-md" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        ) : data && data.length > 0 ? (
          <>
            <div className="space-y-4">
              {data.map((item) => (
                <div 
                  key={item.id} 
                  className="flex items-center gap-3 border-b pb-3 last:border-0 last:pb-0"
                >
                  <div 
                    className="bg-primary/10 h-12 w-12 rounded-md flex items-center justify-center text-primary font-semibold"
                  >
                    {item.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate">{item.name}</h4>
                    <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
                  </div>
                  <Badge variant="outline" className="font-semibold">
                    {item.quantity} in stock
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    onClick={() => setLocation(`/inventory/${item.id}`)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center">
              <Button 
                variant="outline"
                onClick={() => setLocation('/inventory')}
              >
                View All Items
              </Button>
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No data available for the selected period.
          </div>
        )}
      </CardContent>
    </Card>
  );
}