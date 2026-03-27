import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarehouseFormFields } from "@/pages/warehouses/warehouse-form-fields";
import type { BinLocation, FormData, WarehousePayload } from "@/pages/warehouses/warehouse-types";
import type { UseMutationResult } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type WarehouseDialogsProps = {
  isCreateDialogOpen: boolean;
  setIsCreateDialogOpen: Dispatch<SetStateAction<boolean>>;
  createFormVariant: "quick" | "full";
  setCreateFormVariant: Dispatch<SetStateAction<"quick" | "full">>;
  isEditDialogOpen: boolean;
  setIsEditDialogOpen: Dispatch<SetStateAction<boolean>>;
  isDeleteDialogOpen: boolean;
  setIsDeleteDialogOpen: Dispatch<SetStateAction<boolean>>;
  formData: FormData;
  setFormData: Dispatch<SetStateAction<FormData>>;
  selectedWarehouse: { name: string } | null;
  createWarehouse: UseMutationResult<unknown, Error, WarehousePayload>;
  updateWarehouse: UseMutationResult<unknown, Error, { id: number; data: WarehousePayload }>;
  deleteWarehouse: UseMutationResult<boolean, Error, number>;
  addBin: () => void;
  updateBin: (index: number, field: keyof BinLocation, value: string) => void;
  removeBin: (index: number) => void;
  handleCreateSubmit: () => void;
  handleEditSubmit: () => void;
  handleDeleteConfirm: () => void;
};

export function WarehouseDialogs({
  isCreateDialogOpen,
  setIsCreateDialogOpen,
  createFormVariant,
  setCreateFormVariant,
  isEditDialogOpen,
  setIsEditDialogOpen,
  isDeleteDialogOpen,
  setIsDeleteDialogOpen,
  formData,
  setFormData,
  selectedWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  addBin,
  updateBin,
  removeBin,
  handleCreateSubmit,
  handleEditSubmit,
  handleDeleteConfirm,
}: WarehouseDialogsProps) {
  return (
    <>
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) setCreateFormVariant("quick");
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Warehouse</DialogTitle>
            <DialogDescription>Quick add essentials, or switch to full layout for bins and JSON details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-sm font-medium">Create mode</Label>
            <RadioGroup
              value={createFormVariant}
              onValueChange={(v) => setCreateFormVariant(v === "full" ? "full" : "quick")}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="quick" id="wh-create-quick" />
                <Label htmlFor="wh-create-quick" className="font-normal cursor-pointer">
                  Quick (name, location, address, contact)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="full" id="wh-create-full" />
                <Label htmlFor="wh-create-full" className="font-normal cursor-pointer">
                  Full (aisles, bins, JSON)
                </Label>
              </div>
            </RadioGroup>
          </div>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSubmit();
            }}
            aria-label="Create warehouse form"
          >
            <fieldset className="grid gap-4 py-4" disabled={createWarehouse.isPending}>
              <WarehouseFormFields
                formData={formData}
                setFormData={setFormData}
                fieldIdPrefix=""
                disabled={createWarehouse.isPending}
                addBin={addBin}
                updateBin={updateBin}
                removeBin={removeBin}
                variant={createFormVariant}
              />
            </fieldset>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createWarehouse.isPending}>
                {createWarehouse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Warehouse
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Warehouse</DialogTitle>
            <DialogDescription>Update the warehouse details.</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              handleEditSubmit();
            }}
            aria-label="Edit warehouse form"
          >
            <fieldset className="grid gap-4 py-4" disabled={updateWarehouse.isPending}>
              <WarehouseFormFields
                formData={formData}
                setFormData={setFormData}
                fieldIdPrefix="edit-"
                disabled={updateWarehouse.isPending}
                addBin={addBin}
                updateBin={updateBin}
                removeBin={removeBin}
              />
            </fieldset>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateWarehouse.isPending}>
                {updateWarehouse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Warehouse</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedWarehouse?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <Alert variant="destructive">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Deleting this warehouse will remove all associated inventory records. Consider transferring inventory to
                another warehouse first.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteWarehouse.isPending}>
              {deleteWarehouse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Warehouse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
