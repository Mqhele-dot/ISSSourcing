import { Plus, Loader2, Building } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageDataState } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { WarehouseTable } from "@/pages/warehouses/warehouse-table";
import { WarehouseDialogs } from "@/pages/warehouses/warehouse-dialogs";
import { useWarehouseCrud } from "@/pages/warehouses/use-warehouse-crud";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Can } from "@/components/auth/can";
import { useState } from "react";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";

export default function WarehousesPage() {
  const crud = useWarehouseCrud();
  const [createWarehouseFormVariant, setCreateWarehouseFormVariant] = useState<"quick" | "full">("quick");

  return (
    <div className="container mx-auto py-6 max-w-7xl" data-testid="warehouses-page">
      <PageHeader
        title="Warehouses"
        description="Manage your warehouse locations and inventory distribution"
        actions={
          <span data-tour="warehouses-actions">
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add warehouses">
              <Button
                onClick={() => {
                  crud.resetForm();
                  setCreateWarehouseFormVariant("quick");
                  crud.setIsCreateDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Warehouse
              </Button>
            </Can>
          </span>
        }
      />

      <ModuleTrainingPanel moduleId="warehouses" />

      {crud.listFallback ? (
        <Alert variant="default" className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTitle>Temporary data outage</AlertTitle>
          <AlertDescription>
            Data could not be loaded from the server. You may see empty or cached results. Try refreshing in a moment.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card data-tour="warehouses-table">
        <CardContent className="p-0">
          <PageDataState
            isLoading={crud.isLoading}
            error={crud.isError ? (crud.error instanceof Error ? crud.error : new Error(String(crud.error))) : null}
            isEmpty={!crud.isLoading && !crud.isError && crud.list.length === 0}
            loadingView={
              <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            }
            errorTitle="Failed to load warehouses"
            onRetry={() => crud.refetch()}
            emptyView={
              <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                <Building className="h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-lg font-medium mb-2">No warehouses found</h3>
                <p className="text-muted-foreground mb-4 max-w-md">
                  You haven&apos;t added any warehouses yet. Add your first warehouse to start managing inventory across
                  multiple locations.
                </p>
                <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add warehouses">
                  <Button
                    onClick={() => {
                      crud.resetForm();
                      setCreateWarehouseFormVariant("quick");
                      crud.setIsCreateDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Your First Warehouse
                  </Button>
                </Can>
              </div>
            }
          >
            <WarehouseTable list={crud.list} onEdit={crud.openEditDialog} onDelete={crud.openDeleteDialog} />
          </PageDataState>
        </CardContent>
      </Card>

      <WarehouseDialogs
        isCreateDialogOpen={crud.isCreateDialogOpen}
        setIsCreateDialogOpen={crud.setIsCreateDialogOpen}
        createFormVariant={createWarehouseFormVariant}
        setCreateFormVariant={setCreateWarehouseFormVariant}
        isEditDialogOpen={crud.isEditDialogOpen}
        setIsEditDialogOpen={crud.setIsEditDialogOpen}
        isDeleteDialogOpen={crud.isDeleteDialogOpen}
        setIsDeleteDialogOpen={crud.setIsDeleteDialogOpen}
        formData={crud.formData}
        setFormData={crud.setFormData}
        selectedWarehouse={crud.selectedWarehouse}
        createWarehouse={crud.createWarehouse}
        updateWarehouse={crud.updateWarehouse}
        deleteWarehouse={crud.deleteWarehouse}
        addBin={crud.addBin}
        updateBin={crud.updateBin}
        removeBin={crud.removeBin}
        handleCreateSubmit={crud.handleCreateSubmit}
        handleEditSubmit={crud.handleEditSubmit}
        handleDeleteConfirm={crud.handleDeleteConfirm}
      />
    </div>
  );
}
