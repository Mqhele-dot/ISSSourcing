import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
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
import { Link, useLocation } from "wouter";
import { 
  BarChart3, 
  Boxes, 
  ClipboardList, 
  Clock, 
  FileBarChart, 
  PackageOpen, 
  QrCode, 
  Settings, 
  ShoppingCart, 
  TrendingUp, 
  Truck, 
  Users,
  AlertCircle,
  Download
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Define quick access menu items
interface QuickAccessItem {
  name: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  badge?: string;
  badgeColor?: "default" | "secondary" | "destructive" | "outline";
}

const quickAccessItems: QuickAccessItem[] = [
  {
    name: "Inventory",
    description: "Manage your inventory items",
    icon: <Boxes className="h-8 w-8" />,
    path: "/inventory",
  },
  {
    name: "Orders",
    description: "View and process orders",
    icon: <ShoppingCart className="h-8 w-8" />,
    path: "/orders",
    badge: "New",
    badgeColor: "secondary",
  },
  {
    name: "Reorder Requests",
    description: "Manage reorder requests",
    icon: <ClipboardList className="h-8 w-8" />,
    path: "/reorder",
    badge: "3",
    badgeColor: "destructive",
  },
  {
    name: "Suppliers",
    description: "Manage your suppliers",
    icon: <Truck className="h-8 w-8" />,
    path: "/suppliers",
  },
  {
    name: "Barcode Scanner",
    description: "Scan barcodes to lookup items",
    icon: <QrCode className="h-8 w-8" />,
    path: "/barcode-scanner",
  },
  {
    name: "Reports",
    description: "Generate inventory reports",
    icon: <FileBarChart className="h-8 w-8" />,
    path: "/reports",
  },
  {
    name: "Analytics",
    description: "Inventory analytics and insights",
    icon: <BarChart3 className="h-8 w-8" />,
    path: "/reports",
  },
  {
    name: "Real-time Sync",
    description: "Monitor inventory synchronization",
    icon: <Clock className="h-8 w-8" />,
    path: "/sync-dashboard",
  },
  {
    name: "User Roles",
    description: "Manage user permissions",
    icon: <Users className="h-8 w-8" />,
    path: "/user-roles",
  },
  {
    name: "Settings",
    description: "Configure application settings",
    icon: <Settings className="h-8 w-8" />,
    path: "/settings",
  },
  {
    name: "Low Stock Items",
    description: "View items needing reorder",
    icon: <AlertCircle className="h-8 w-8" />,
    path: "/inventory?filter=low_stock",
    badge: "Alert",
    badgeColor: "destructive",
  },
  {
    name: "Desktop App",
    description: "Download desktop application",
    icon: <Download className="h-8 w-8" />,
    path: "/download",
    badge: "New",
    badgeColor: "secondary",
  },
];

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
          <h2 className="text-3xl font-bold tracking-tight">Inventory Management System</h2>
          <p className="text-muted-foreground">
            Complete solution for your business inventory needs
          </p>
        </div>
        <TutorialButton pageName="home" />
      </div>

      {/* Quick Access Menu */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4">Quick Access</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {quickAccessItems.map((item, index) => (
            <Link key={index} href={item.path}>
              <Card className="h-full hover:bg-accent/50 transition-colors cursor-pointer overflow-hidden">
                <CardContent className="pt-6 pb-4 px-4 flex flex-col items-center text-center h-full">
                  <div className="mb-3 relative">
                    {item.icon}
                    {item.badge && (
                      <Badge 
                        className="absolute -top-2 -right-2" 
                        variant={item.badgeColor}
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="w-full">
                    <h4 className="font-medium text-sm mb-1 truncate">{item.name}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Summary Stats Section */}
      <div className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Total Items</p>
                  <h3 className="text-2xl font-bold">
                    {statsLoading ? <Skeleton className="w-16 h-8" /> : stats?.totalItems || 0}
                  </h3>
                </div>
                <Boxes className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Low Stock Items</p>
                  <h3 className="text-2xl font-bold">
                    {statsLoading ? <Skeleton className="w-16 h-8" /> : stats?.lowStockItems || 0}
                  </h3>
                </div>
                <AlertCircle className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Out of Stock</p>
                  <h3 className="text-2xl font-bold">
                    {statsLoading ? <Skeleton className="w-16 h-8" /> : stats?.outOfStockItems || 0}
                  </h3>
                </div>
                <PackageOpen className="h-8 w-8 text-destructive" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Total Value</p>
                  <h3 className="text-2xl font-bold">
                    {statsLoading ? 
                      <Skeleton className="w-24 h-8" /> : 
                      formatCurrency(stats?.inventoryValue || 0)
                    }
                  </h3>
                </div>
                <TrendingUp className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-xl font-bold tracking-tight">Inventory Analytics</h3>
        <p className="text-muted-foreground">
          Visual insights into your inventory data
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <div className="overflow-x-auto">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="items">Items</TabsTrigger>
          </TabsList>
        </div>

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
      
      {/* Recent Activity and Alerts Section */}
      <div className="mt-10 mb-6">
        <h3 className="text-xl font-bold tracking-tight mb-6">Recent Activity & Alerts</h3>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Recent Activities</span>
                <Button variant="ghost" size="sm" className="text-primary">
                  View All
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {statsLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-4 bg-muted/50 p-3 rounded-lg">
                      <div className="bg-primary/10 p-2 rounded-full">
                        <PackageOpen className="h-5 w-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">New inventory items added</p>
                        <p className="text-xs text-muted-foreground">10 new items were added to Electronics category</p>
                      </div>
                      <div className="ml-auto text-xs text-muted-foreground">2 hours ago</div>
                    </div>
                    
                    <div className="flex items-start gap-4 bg-muted/50 p-3 rounded-lg">
                      <div className="bg-amber-500/10 p-2 rounded-full">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Low stock alert triggered</p>
                        <p className="text-xs text-muted-foreground">3 items have reached their reorder point</p>
                      </div>
                      <div className="ml-auto text-xs text-muted-foreground">5 hours ago</div>
                    </div>
                    
                    <div className="flex items-start gap-4 bg-muted/50 p-3 rounded-lg">
                      <div className="bg-green-500/10 p-2 rounded-full">
                        <ShoppingCart className="h-5 w-5 text-green-500" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Order completed</p>
                        <p className="text-xs text-muted-foreground">Order #1234 has been fulfilled and shipped</p>
                      </div>
                      <div className="ml-auto text-xs text-muted-foreground">Yesterday</div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Upcoming Tasks</span>
                <Button variant="ghost" size="sm" className="text-primary">
                  View All
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {statsLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-4 bg-destructive/10 p-3 rounded-lg">
                      <div className="bg-destructive/10 p-2 rounded-full">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Critical: 3 items out of stock</p>
                        <p className="text-xs text-muted-foreground">Please process reorder requests immediately</p>
                      </div>
                      <div className="ml-auto">
                        <Badge variant="destructive">High</Badge>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 bg-muted/50 p-3 rounded-lg">
                      <div className="bg-amber-500/10 p-2 rounded-full">
                        <Clock className="h-5 w-5 text-amber-500" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Inventory audit scheduled</p>
                        <p className="text-xs text-muted-foreground">Complete quarterly inventory audit by Friday</p>
                      </div>
                      <div className="ml-auto">
                        <Badge variant="outline">Medium</Badge>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 bg-muted/50 p-3 rounded-lg">
                      <div className="bg-primary/10 p-2 rounded-full">
                        <FileBarChart className="h-5 w-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Generate monthly report</p>
                        <p className="text-xs text-muted-foreground">End of month inventory and sales report needed</p>
                      </div>
                      <div className="ml-auto">
                        <Badge>Normal</Badge>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* App Information Footer */}
      <div className="mt-10 mb-6 border-t pt-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-lg font-semibold">Inventory Management System</h3>
            <p className="text-sm text-muted-foreground">Version 1.0.0 | Desktop App Available</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/download">
                <Download className="h-4 w-4 mr-2" />
                Download Desktop App
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/support">
                Get Support
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}