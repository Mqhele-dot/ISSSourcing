import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings,
  Shield,
  TrendingUp,
  BarChart3,
  Truck,
  Lock,
} from "lucide-react";
import { CustomKPIBuilder } from "@/components/dashboard/custom-kpi-builder";
import { PredictiveAnalyticsPanel } from "@/components/dashboard/predictive-analytics-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";

/**
 * Enhanced Admin Control Panel
 * Central hub for security policies, analytics, and operational controls
 */
export default function AdminControlPanelPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");

  if (user?.role !== "admin") {
    return (
      <PageShell>
        <PageHeader
          title="Admin Control Panel"
          description="Access denied"
          icon={Settings}
        />
        <div className="text-center py-8">
          <p className="text-gray-600">You do not have permission to access this page.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Admin Control Panel"
        description="Manage security policies, analytics, and operational settings"
        icon={Settings}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Security Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">Good</div>
                <p className="text-xs text-gray-500 mt-1">All policies configured</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  2FA Adoption
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">65%</div>
                <p className="text-xs text-gray-500 mt-1">Of users enabled</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Active KPIs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">8</div>
                <p className="text-xs text-gray-500 mt-1">Custom metrics tracked</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Transfers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">12</div>
                <p className="text-xs text-gray-500 mt-1">Pending approval</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/settings">
                  <Button className="w-full justify-start" variant="outline">
                    View Settings
                  </Button>
                </Link>
                <Link href="/multi-warehouse-transfers">
                  <Button className="w-full justify-start" variant="outline">
                    Warehouse Transfers
                  </Button>
                </Link>
                <Button className="w-full justify-start" variant="outline">
                  Run System Diagnostics
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <p className="text-gray-600">
                    • Security policy updated - 2 hours ago
                  </p>
                  <p className="text-gray-600">
                    • 3 new warehouse transfers - 5 hours ago
                  </p>
                  <p className="text-gray-600">
                    • Forecast accuracy improved - Yesterday
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Security policy</CardTitle>
              <CardDescription>Security policy is managed from Admin Settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild><a href="/admin/settings/security">Open Security Settings</a></Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6 mt-6">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Predictive Analytics</h3>
              <PredictiveAnalyticsPanel />
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4">Custom KPI Management</h3>
              <CustomKPIBuilder />
            </div>
          </div>
        </TabsContent>

        {/* Operations Tab */}
        <TabsContent value="operations" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Warehouse Operations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-gray-600">
                Manage multi-warehouse transfers, inventory movements, and operational workflows.
              </p>
              <Link href="/multi-warehouse-transfers">
                <Button className="gap-2">
                  <Truck className="h-4 w-4" />
                  Go to Warehouse Transfers
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>System Maintenance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Database Optimization</h4>
                <p className="text-sm text-gray-600">
                  Run periodic maintenance tasks to optimize database performance.
                </p>
                <Button variant="outline" size="sm">
                  Run Maintenance
                </Button>
              </div>

              <div className="border-t pt-4 space-y-2">
                <h4 className="font-semibold text-sm">Cache Management</h4>
                <p className="text-sm text-gray-600">
                  Clear application caches to force refresh of data.
                </p>
                <Button variant="outline" size="sm">
                  Clear Caches
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
