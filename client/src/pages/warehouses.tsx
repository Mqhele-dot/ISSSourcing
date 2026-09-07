import { Database, MoveRight, Warehouse } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";
import { Link } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export default function WarehousesPage() {
  return (
    <div className="container mx-auto py-6 max-w-7xl" data-testid="warehouses-page">
      <PageHeader
        title="Warehouses"
        description="Warehouse setup lives in Master Data. Stock movement, storage, receiving, and cycle work live in Warehouse Operations."
      />

      <ModuleTrainingPanel moduleId="warehouses" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Warehouse setup
            </CardTitle>
            <CardDescription>
              Create warehouses, maintain addresses, aisles, bins, and setup details in Master Data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={APP_ROUTES.admin.masterDataSection("warehouses")}>
                Open warehouse master data
                <MoveRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5" />
              Warehouse operations
            </CardTitle>
            <CardDescription>
              Move, receive, count, allocate, and inspect stock from the warehouse operations workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={APP_ROUTES.inventory.warehouseOperations}>
                Open warehouse operations
                <MoveRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
