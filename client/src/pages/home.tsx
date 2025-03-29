import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import TutorialButton from "@/components/ui/tutorial-button";
import { type InventoryItem, type Category, type InventoryStats } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";

// Custom colors for charts
const COLORS = [
  "#0088FE", // Blue
  "#00C49F", // Green
  "#FFBB28", // Yellow
  "#FF8042", // Orange
  "#8884D8", // Purple
  "#FF6B6B", // Pink
  "#4CAF50", // Dark Green
  "#9C27B0", // Violet
];

// Custom tooltip for charts
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-neutral-800 p-3 rounded-md border border-neutral-200 dark:border-neutral-700 shadow-md">
        <p className="font-medium">{`${label}`}</p>
        {payload.map((entry: any, index: number) => (
          <p key={`item-${index}`} style={{ color: entry.color }}>
            {`${entry.name}: ${entry.value}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function Home() {
  const { toast } = useToast();

  // Fetch inventory items
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const response = await fetch("/api/inventory");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory items");
      }
      return response.json() as Promise<InventoryItem[]>;
    },
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const response = await fetch("/api/categories");
      if (!response.ok) {
        throw new Error("Failed to fetch categories");
      }
      return response.json() as Promise<Category[]>;
    },
  });

  // Fetch inventory stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory stats");
      }
      return response.json() as Promise<InventoryStats>;
    },
  });

  // Prepare data for inventory by category chart
  const inventoryByCategoryData = React.useMemo(() => {
    if (!inventoryItems || !categories) return [];

    const categoryMap = new Map<number, { name: string; count: number }>();
    
    // Initialize with all categories
    categories.forEach(cat => {
      categoryMap.set(cat.id, { name: cat.name, count: 0 });
    });
    
    // Count items per category
    inventoryItems.forEach(item => {
      if (item.categoryId) {
        const category = categoryMap.get(item.categoryId);
        if (category) {
          category.count += 1;
        }
      }
    });
    
    return Array.from(categoryMap.values())
      .filter(cat => cat.count > 0) // Only include categories with items
      .map(cat => ({ 
        name: cat.name, 
        items: cat.count 
      }));
  }, [inventoryItems, categories]);

  // Prepare data for inventory value by category chart
  const inventoryValueByCategoryData = React.useMemo(() => {
    if (!inventoryItems || !categories) return [];

    const categoryMap = new Map<number, { name: string; value: number }>();
    
    // Initialize with all categories
    categories.forEach(cat => {
      categoryMap.set(cat.id, { name: cat.name, value: 0 });
    });
    
    // Sum value per category
    inventoryItems.forEach(item => {
      if (item.categoryId) {
        const category = categoryMap.get(item.categoryId);
        if (category) {
          category.value += item.price * item.quantity;
        }
      }
    });
    
    return Array.from(categoryMap.values())
      .filter(cat => cat.value > 0) // Only include categories with value
      .map(cat => ({ 
        name: cat.name, 
        value: cat.value 
      }));
  }, [inventoryItems, categories]);

  // Prepare data for inventory quantity by item chart
  const inventoryQuantityByItemData = React.useMemo(() => {
    if (!inventoryItems) return [];
    
    return inventoryItems
      .filter(item => item.quantity > 0) // Filter out zero quantity items
      .map(item => ({
        name: item.name,
        quantity: item.quantity
      }))
      .sort((a, b) => b.quantity - a.quantity) // Sort by quantity descending
      .slice(0, 10); // Take top 10
  }, [inventoryItems]);

  // Prepare data for item value chart
  const inventoryValueByItemData = React.useMemo(() => {
    if (!inventoryItems) return [];
    
    return inventoryItems
      .map(item => ({
        name: item.name,
        value: item.price * item.quantity
      }))
      .sort((a, b) => b.value - a.value) // Sort by value descending
      .slice(0, 10); // Take top 10
  }, [inventoryItems]);

  // Prepare data for status distribution
  const statusDistributionData = React.useMemo(() => {
    if (!stats) return [];
    
    return [
      { name: "In Stock", value: stats.totalItems - stats.lowStockItems - stats.outOfStockItems },
      { name: "Low Stock", value: stats.lowStockItems },
      { name: "Out of Stock", value: stats.outOfStockItems }
    ].filter(item => item.value > 0);
  }, [stats]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Inventory Analytics</h2>
          <p className="text-muted-foreground">
            Visual insights into your inventory data
          </p>
        </div>
        <TutorialButton pageName="home" />
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle>Inventory Status Distribution</CardTitle>
                <CardDescription>
                  Distribution of items by stock status
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                {statsLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Skeleton className="h-[250px] w-[250px] rounded-full" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDistributionData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {statusDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Items by Category</CardTitle>
                <CardDescription>
                  Number of inventory items per category
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                {itemsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-[250px] w-full" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={inventoryByCategoryData}
                      margin={{
                        top: 5,
                        right: 30,
                        left: 20,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="items" fill="#0088FE" name="Items" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Value by Category</CardTitle>
              <CardDescription>
                Total value of inventory items per category
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
              {itemsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-[350px] w-full" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={inventoryValueByCategoryData}
                    margin={{
                      top: 5,
                      right: 30,
                      left: 20,
                      bottom: 5,
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis 
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip 
                      formatter={(value) => [`$${value}`, "Value"]}
                      content={<CustomTooltip />}
                    />
                    <Legend />
                    <Bar dataKey="value" fill="#00C49F" name="Value ($)" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top Items by Quantity</CardTitle>
                <CardDescription>
                  Inventory items with highest quantity in stock
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[400px]">
                {itemsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-[350px] w-full" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={inventoryQuantityByItemData}
                      layout="vertical"
                      margin={{
                        top: 5,
                        right: 30,
                        left: 100,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        width={80}
                        tickFormatter={(value) => 
                          value.length > 15 ? `${value.substring(0, 15)}...` : value
                        }
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="quantity" fill="#FFBB28" name="Quantity" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Items by Value</CardTitle>
                <CardDescription>
                  Inventory items with highest total value
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[400px]">
                {itemsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-[350px] w-full" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={inventoryValueByItemData}
                      layout="vertical"
                      margin={{
                        top: 5,
                        right: 30,
                        left: 100,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        type="number"
                        tickFormatter={(value) => `$${value}`}
                      />
                      <YAxis 
                        type="category" 
                        dataKey="name" 
                        width={80}
                        tickFormatter={(value) => 
                          value.length > 15 ? `${value.substring(0, 15)}...` : value
                        }
                      />
                      <Tooltip 
                        formatter={(value) => [`$${value}`, "Value"]}
                        content={<CustomTooltip />}
                      />
                      <Legend />
                      <Bar dataKey="value" fill="#FF8042" name="Value ($)" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}