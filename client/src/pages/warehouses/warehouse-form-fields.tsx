import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { BinLocation, FormData } from "@/pages/warehouses/warehouse-types";

type WarehouseFormFieldsProps = {
  formData: FormData;
  setFormData: Dispatch<SetStateAction<FormData>>;
  fieldIdPrefix: "" | "edit-";
  disabled?: boolean;
  addBin: () => void;
  updateBin: (index: number, field: keyof BinLocation, value: string) => void;
  removeBin: (index: number) => void;
  /** Quick add hides aisles, bins, and JSON location block (create dialog only). */
  variant?: "full" | "quick";
};

/** Shared create/edit warehouse form body (used inside dialogs on warehouses page). */
export function WarehouseFormFields({
  formData,
  setFormData,
  fieldIdPrefix,
  disabled = false,
  addBin,
  updateBin,
  removeBin,
  variant = "full",
}: WarehouseFormFieldsProps) {
  const p = fieldIdPrefix;
  const showAdvanced = variant === "full";
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${p}name`}>Warehouse Name *</Label>
        <Input
          id={`${p}name`}
          name="name"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={p ? undefined : "Main Warehouse"}
          aria-required="true"
          aria-label="Warehouse name"
          disabled={disabled}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${p}location`}>Location</Label>
        <Input
          id={`${p}location`}
          name="location"
          value={formData.location}
          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          placeholder={p ? undefined : "Building A, Floor 2"}
          aria-label="Warehouse location"
          disabled={disabled}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${p}address`}>Address</Label>
        <Textarea
          id={`${p}address`}
          name="address"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          placeholder={p ? undefined : "123 Main Street, City, Country"}
          rows={2}
          aria-label="Warehouse address"
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${p}contactPerson`}>Contact Person</Label>
          <Input
            id={`${p}contactPerson`}
            name="contactPerson"
            value={formData.contactPerson}
            onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
            placeholder={p ? undefined : "John Doe"}
            disabled={disabled}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${p}contactPhone`}>Contact Phone</Label>
          <Input
            id={`${p}contactPhone`}
            name="contactPhone"
            value={formData.contactPhone}
            onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
            placeholder={p ? undefined : "+1 (555) 123-4567"}
            disabled={disabled}
          />
        </div>
      </div>

      {showAdvanced ? (
        <>
          <p className="text-sm font-medium text-muted-foreground pt-2 border-t">Aisles, Bins & Locations</p>
          <div className="grid gap-2">
            <Label htmlFor={`${p}aisles`}>Aisles (comma-separated)</Label>
            <Input
              id={`${p}aisles`}
              value={formData.aisles}
              onChange={(e) => setFormData({ ...formData, aisles: e.target.value })}
              placeholder="A-1, A-2, B-1, B-2"
              disabled={disabled}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${p}locationDetails`}>Location details (optional JSON)</Label>
            <Textarea
              id={`${p}locationDetails`}
              value={formData.locationDetails}
              onChange={(e) => setFormData({ ...formData, locationDetails: e.target.value })}
              placeholder='{"zone": "A", "floor": 1}'
              rows={2}
              className="font-mono text-sm"
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">Add custom fields as JSON for zones, floors, etc.</p>
          </div>
          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label>Bins / Locations</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBin}
                aria-label="Add bin or location"
                disabled={disabled}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add bin
              </Button>
            </div>
            {formData.bins.map((bin, i) => (
              <div key={i} className="flex gap-2 items-center p-2 border rounded-md">
                <Input
                  placeholder="Code"
                  value={bin.code}
                  onChange={(e) => updateBin(i, "code", e.target.value)}
                  className="flex-1"
                  disabled={disabled}
                />
                <Input
                  placeholder="Aisle"
                  value={bin.aisle ?? ""}
                  onChange={(e) => updateBin(i, "aisle", e.target.value)}
                  className="w-20"
                  disabled={disabled}
                />
                <Input
                  placeholder="Row"
                  value={bin.row ?? ""}
                  onChange={(e) => updateBin(i, "row", e.target.value)}
                  className="w-20"
                  disabled={disabled}
                />
                <Input
                  placeholder="Shelf"
                  value={bin.shelf ?? ""}
                  onChange={(e) => updateBin(i, "shelf", e.target.value)}
                  className="w-20"
                  disabled={disabled}
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeBin(i)} disabled={disabled}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Quick add includes essentials only. Switch to &quot;Full&quot; to configure aisles, bins, and JSON location details.
        </p>
      )}
      <div className="flex items-center space-x-2 mt-2">
        <Switch
          id={`${p}isDefault`}
          checked={formData.isDefault}
          onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
          disabled={disabled}
        />
        <Label htmlFor={`${p}isDefault`}>Set as default warehouse</Label>
      </div>
    </>
  );
}
