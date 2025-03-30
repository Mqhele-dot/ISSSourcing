import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, subMonths, addMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarIcon, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useDateRangeParams } from '@/hooks/use-date-range-params';

interface DemandForecastPoint {
  date: string;
  itemId: number;
  itemName: string;
  historical: number | null;
  forecast: number | null;
  accuracy: number | null;
}

interface DemandForecastProps {
  itemId: number;
  itemName: string;
}

export function DemandForecast({ itemId, itemName }: DemandForecastProps) {
  const { dateRange, updateDateRange, range, updateRange } = useDateRangeParams(90);
  const [view, setView] = useState<'3m' | '6m' | '12m'>('3m');

  // Build query parameters
  const queryParams = new URLSearchParams();
  
  if (dateRange?.from) {
    queryParams.append("startDate", format(dateRange.from, "yyyy-MM-dd"));
  }
  
  if (dateRange?.to) {
    queryParams.append("endDate", format(dateRange.to, "yyyy-MM-dd"));
  }

  // Fetch forecast data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [`/api/analytics/demand-forecast/${itemId}`, queryParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/analytics/demand-forecast/${itemId}?${queryParams.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch demand forecast');
      }
      return response.json() as Promise<DemandForecastPoint[]>;
    },
  });

  const handleViewChange = (newView: '3m' | '6m' | '12m') => {
    setView(newView);
    
    const today = new Date();
    let newFrom: Date;
    
    switch (newView) {
      case '3m':
        newFrom = subMonths(today, 2);
        break;
      case '6m':
        newFrom = subMonths(today, 5);
        break;
      case '12m':
        newFrom = subMonths(today, 11);
        break;
    }
    
    updateDateRange({
      from: newFrom,
      to: addMonths(today, 1)
    });
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Demand Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center p-6">
            <p className="text-destructive">Error loading forecast data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate average accuracy from forecast data
  const averageAccuracy = data && data.length > 0
    ? data.reduce((acc, point) => {
        return point.accuracy !== null ? acc + point.accuracy : acc;
      }, 0) / data.filter(point => point.accuracy !== null).length
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
          <div>
            <CardTitle>Demand Forecast</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Historical and predicted demand for {itemName}
            </p>
          </div>
          <div className="flex items-center space-x-2 mt-2 md:mt-0">
            <DateRangePicker
              date={dateRange}
              onDateChange={updateDateRange}
              className="w-[220px]"
            />
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => refetch()}
              title="Refresh data"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          <Button 
            variant={view === '3m' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => handleViewChange('3m')}
          >
            3 Months
          </Button>
          <Button 
            variant={view === '6m' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => handleViewChange('6m')}
          >
            6 Months
          </Button>
          <Button 
            variant={view === '12m' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => handleViewChange('12m')}
          >
            12 Months
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-[300px] w-full" />
          </div>
        ) : data && data.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-secondary/30 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Forecast Accuracy</p>
                <h3 className="text-2xl font-bold">
                  {averageAccuracy !== null 
                    ? `${Math.round(averageAccuracy * 100)}%`
                    : 'N/A'}
                </h3>
              </div>
              <div className="bg-secondary/30 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Next Month Forecast</p>
                <h3 className="text-2xl font-bold">
                  {data.find(d => d.forecast !== null)?.forecast || 'N/A'}
                </h3>
              </div>
            </div>
            
            <div className="h-[300px] mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                  data={data.map(d => ({
                    ...d,
                    date: format(parseISO(d.date), 'MMM dd')
                  }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis />
                  <Tooltip 
                    formatter={(value: any) => [value, 'Units']}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="historical" 
                    name="Historical Demand"
                    stroke="#8884d8" 
                    activeDot={{ r: 8 }} 
                    strokeWidth={2}
                    connectNulls
                  />
                  <Line 
                    type="monotone" 
                    dataKey="forecast" 
                    name="Forecast" 
                    stroke="#82ca9d" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 text-sm text-muted-foreground">
              <p className="flex items-center">
                <span className="inline-block w-3 h-3 bg-[#8884d8] mr-2"></span>
                Historical: Actual demand based on past stock movements
              </p>
              <p className="flex items-center">
                <span className="inline-block w-3 h-3 bg-[#82ca9d] mr-2"></span>
                Forecast: Predicted future demand based on historical patterns
              </p>
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No forecast data available for this item.
          </div>
        )}
      </CardContent>
    </Card>
  );
}