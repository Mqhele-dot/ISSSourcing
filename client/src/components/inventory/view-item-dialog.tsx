import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { getItemStatus, getStatusColor } from "@/lib/utils";
import type { InventoryItem } from "@shared/schema";
import type { Category } from "@shared/schema";

interface ViewItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
  categories: Category[] | undefined;
  onEdit: () => void;
}

export default function ViewItemDialog({
  open,
  onOpenChange,
  item,
  categories,
  onEdit,
}: ViewItemDialogProps) {
  if (!item) return null;

  const category = categories?.find((c) => c.id === item.categoryId);
  const status = getItemStatus(item);
  const statusStyle = getStatusColor(status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>View Item</DialogTitle>
          <DialogDescription>Inventory item details (read-only)</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">Name</p>
            <p className="font-medium">{item.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">SKU</p>
            <p className="font-mono text-sm">{item.sku}</p>
          </div>
          {item.description ? (
            <div>
              <p className="text-sm text-muted-foreground">Description</p>
              <p className="text-sm">{item.description}</p>
            </div>
          ) : null}
          <div>
            <p className="text-sm text-muted-foreground">Category</p>
            <p className="font-medium">{category?.name ?? "Uncategorized"}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Quantity</p>
              <p className="font-medium">{item.quantity}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <span
                className={`inline-flex text-xs leading-5 font-semibold rounded-full px-2 ${statusStyle.bg} ${statusStyle.text}`}
              >
                {status}
              </span>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Price</p>
              <p className="font-medium">{formatCurrency(item.price ?? 0)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cost</p>
              <p className="font-medium">{formatCurrency(item.cost ?? 0)}</p>
            </div>
          </div>
          {item.location ? (
            <div>
              <p className="text-sm text-muted-foreground">Location</p>
              <p className="text-sm">{item.location}</p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => { onOpenChange(false); onEdit(); }}>
              Edit item
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
