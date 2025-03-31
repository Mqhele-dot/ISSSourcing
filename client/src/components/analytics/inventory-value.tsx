import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface InventoryValueItem {
  id: number;
  name: string;
  quantity: number;
  cost: number;
  value: number;
}

interface InventoryValueData {
  totalValue: number;
  totalItems: number;
  items: InventoryValueItem[];
}

export function InventoryValue() {
  // Fetch inventory value data
  const { data, isLoading, error } = useQuery({
    queryKey: ['/api/analytics/inventory-value'],
    queryFn: async () => {
      const response = await fetch('/api/analytics/inventory-value');
      if (!response.ok) {
        throw new Error('Failed to fetch inventory value data');
      }
      return response.json() as Promise<InventoryValueData>;
    },
  });

  // Prepare data for the chart
  const chartData = useMemo(() => {
    if (!data || !data.items || data.items.length === 0) return [];

    // Group smaller items into "Other" category
    const topItems = data.items.slice(0, 6); // Take top 6 items
    const otherItems = data.items.slice(6); // The rest become "Other"
    
    const result = topItems.map(item => ({
      name: item.name,
      value: item.value,
    }));
    
    // Add "Other" category if we have more than 6 items
    if (otherItems.length > 0) {
      const otherValue = otherItems.reduce((sum, item) => sum + item.value, 0);
      result.push({
        name: 'Other',
        value: otherValue,
      });
    }
    
    return result;
  }, [data]);

  // Color scale for the chart
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#bbb'];

  // Custom tooltip for the chart
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border p-2 rounded-md shadow">
          <p className="font-medium">{payload[0].name}</p>
          <p style={{ color: payload[0].color }}>
            Value: {formatCurrency(payload[0].value)}
          </p>
          {data && (
            <p className="text-xs text-muted-foreground">
              ({((payload[0].value / data.totalValue) * 100).toFixed(1)}% of total)
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inventory Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center p-6">
            <p className="text-destructive">Error loading inventory value data.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory Value Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-6">
            <div className="flex justify-between">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-32" />
            </div>
            <Skeleton className="h-[250px] w-full" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-secondary/30 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Total Value</p>
                <h3 className="text-2xl font-bold">{formatCurrency(data.totalValue)}</h3>
              </div>
              <div className="bg-secondary/30 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Total Items</p>
                <h3 className="text-2xl font-bold">{data.totalItems.toLocaleString()}</h3>
              </div>
            </div>
            
            {chartData.length > 0 ? (
              <div className="h-[300px] mt-6">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={40}
                      dataKey="value"
                      labelLine={false}
                      label={false} // Remove inline labels to prevent overlapping
                    >
                      {chartData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                      layout="horizontal" 
                      align="center" 
                      verticalAlign="bottom"
                      formatter={(value, entry) => {
                        // Truncate long names and show tooltip on hover
                        return value.length > 10 ? `${value.substring(0, 10)}...` : value;
                      }}
                      wrapperStyle={{ 
                        paddingTop: '10px', 
                        width: '100%', 
                        display: 'flex', 
                        flexWrap: 'wrap', 
                        justifyContent: 'center', 
                        gap: '10px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                No inventory value data available.
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No inventory value data available.
          </div>
        )}
      </CardContent>
    </Card>
  );
}