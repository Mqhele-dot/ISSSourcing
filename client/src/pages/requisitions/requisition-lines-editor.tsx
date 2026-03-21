import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InventoryItem } from "@shared/schema";

export interface ReqLineDraft {
  itemId: number;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

type RequisitionLinesEditorProps = {
  items: ReqLineDraft[];
  inventoryItems: InventoryItem[];
  fieldError?: string;
  onAddRow: () => void;
  onRemoveRow: (idx: number) => void;
  onUpdateRow: (idx: number, field: keyof ReqLineDraft, value: number | string) => void;
};

export function RequisitionLinesEditor({
  items,
  inventoryItems,
  fieldError,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
}: RequisitionLinesEditorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label id="req-items-label">Items</Label>
        <Button type="button" variant="outline" size="sm" onClick={onAddRow} aria-label="Add item row">
          <Plus className="mr-2 h-4 w-4" />
          Add item
        </Button>
      </div>
      <div className="space-y-4" role="group" aria-labelledby="req-items-label">
        {items.map((item, idx) => (
          <div key={idx} className="flex gap-2 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor={"req-item-" + idx}>Item *</Label>
              <Select
                value={item.itemId ? String(item.itemId) : ""}
                onValueChange={(v) => onUpdateRow(idx, "itemId", v ? Number(v) : 0)}
              >
                <SelectTrigger id={"req-item-" + idx} aria-label={"Select item for line " + (idx + 1)}>
                  <SelectValue placeholder="Select item..." />
                </SelectTrigger>
                <SelectContent>
                  {inventoryItems.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.name} ({i.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-24 space-y-2">
              <Label htmlFor={"req-qty-" + idx}>Qty *</Label>
              <Input
                id={"req-qty-" + idx}
                aria-label={"Quantity for line " + (idx + 1)}
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => onUpdateRow(idx, "quantity", Number(e.target.value))}
              />
            </div>
            <div className="w-28 space-y-2">
              <Label htmlFor={"req-unitprice-" + idx}>Unit price *</Label>
              <Input
                id={"req-unitprice-" + idx}
                aria-label={"Unit price for line " + (idx + 1)}
                type="number"
                min={0}
                step={0.01}
                value={item.unitPrice}
                onChange={(e) => onUpdateRow(idx, "unitPrice", Number(e.target.value))}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemoveRow(idx)}
              aria-label={"Remove item line " + (idx + 1)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
      {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
    </div>
  );
}
