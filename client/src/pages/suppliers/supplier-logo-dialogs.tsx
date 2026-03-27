import type { Dispatch, SetStateAction } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SupplierLogo } from "@shared/schema";

export type SupplierLogoForm = {
  logoUrl: string;
};

type SupplierLogoDialogsProps = {
  removeLogoConfirm: boolean;
  setRemoveLogoConfirm: Dispatch<SetStateAction<boolean>>;
  selectedSupplierId: number | null;
  deleteLogo: UseMutationResult<{ success: boolean }, Error, number, unknown>;
  setLogoDialogOpen: (open: boolean) => void;
  logoDialogOpen: boolean;
  selectedLogo: SupplierLogo | null | undefined;
  logoForm: UseFormReturn<SupplierLogoForm>;
  handleLogoSubmit: (data: SupplierLogoForm) => void;
};

/** Logo management dialogs extracted from suppliers page for maintainability. */
export function SupplierLogoDialogs({
  removeLogoConfirm,
  setRemoveLogoConfirm,
  selectedSupplierId,
  deleteLogo,
  setLogoDialogOpen,
  logoDialogOpen,
  selectedLogo,
  logoForm,
  handleLogoSubmit,
}: SupplierLogoDialogsProps) {
  return (
    <>
      <AlertDialog
        open={removeLogoConfirm}
        onOpenChange={(open) => {
          if (!open) setRemoveLogoConfirm(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove logo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the logo for this supplier. You can add a new one later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selectedSupplierId) {
                  deleteLogo.mutate(selectedSupplierId, {
                    onSettled: () => {
                      setRemoveLogoConfirm(false);
                      setLogoDialogOpen(false);
                    },
                  });
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={logoDialogOpen} onOpenChange={setLogoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Supplier Logo</DialogTitle>
            <DialogDescription>
              {selectedLogo ? "Update the logo for this supplier" : "Add a logo URL for this supplier"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={logoForm.handleSubmit(handleLogoSubmit)}>
            {selectedLogo && (
              <div className="flex justify-center mb-4">
                <div className="h-24 w-24 border rounded-md overflow-hidden">
                  <img src={selectedLogo.logoUrl} alt="Supplier logo" className="h-full w-full object-contain" />
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input id="logoUrl" placeholder="https://example.com/logo.png" {...logoForm.register("logoUrl")} />
                <p className="text-sm text-muted-foreground">Enter a URL for the supplier&apos;s logo image</p>
              </div>

              <div className="flex justify-between">
                {selectedLogo && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => setRemoveLogoConfirm(true)}
                  >
                    Remove Logo
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setLogoDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{selectedLogo ? "Update Logo" : "Add Logo"}</Button>
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
