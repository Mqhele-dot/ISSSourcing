import type { Dispatch, SetStateAction } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Can } from "@/components/auth/can";
import type { PurchaseOrderDetail } from "@/api/client";

type PoReceivePanelProps = {
  /** Anchor id for in-page navigation (e.g. po-receive). */
  sectionId?: string;
  className?: string;
  detail: PurchaseOrderDetail;
  canReceive: boolean;
  receiveState: Record<string, number>;
  setReceiveState: Dispatch<SetStateAction<Record<string, number>>>;
  batchState: Record<string, string>;
  setBatchState: Dispatch<SetStateAction<Record<string, string>>>;
  serialState: Record<string, string>;
  setSerialState: Dispatch<SetStateAction<Record<string, string>>>;
  receiverName: string;
  setReceiverName: (v: string) => void;
  warehouseLocation: string;
  setWarehouseLocation: (v: string) => void;
  userId?: number;
  receiving: boolean;
  receiveError?: string | null;
  onSubmitReceive: () => void | Promise<void>;
};

/** GRN-style receive grid for a single PO detail view. */
export function PoReceivePanel({
  sectionId,
  className,
  detail,
  canReceive,
  receiveState,
  setReceiveState,
  batchState,
  setBatchState,
  serialState,
  setSerialState,
  receiverName,
  setReceiverName,
  warehouseLocation,
  setWarehouseLocation,
  userId,
  receiving,
  receiveError,
  onSubmitReceive,
}: PoReceivePanelProps) {
  return (
    <Card id={sectionId} className={className} data-testid="po-receive-panel">
      <CardHeader>
        <CardTitle>Receive panel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Supplier part #</TableHead>
              <TableHead>Commodity</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Serial numbers</TableHead>
              <TableHead className="text-right">Receive now</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-medium">{line.sku}</TableCell>
                <TableCell>{line.itemName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {line.supplierPartNumber?.trim() ? line.supplierPartNumber : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {line.commodityCode
                    ? `${line.commodityCode}${line.commodityDescription ? ` — ${line.commodityDescription}` : ""}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right">{line.qtyOrdered}</TableCell>
                <TableCell className="text-right">{line.qtyReceived}</TableCell>
                <TableCell className="text-right">{line.expectedRemaining}</TableCell>
                <TableCell>
                  <Input
                    placeholder="Batch #"
                    value={batchState[line.sku] ?? ""}
                    onChange={(event) =>
                      setBatchState((current) => ({
                        ...current,
                        [line.sku]: event.target.value,
                      }))
                    }
                    disabled={!canReceive}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    placeholder="Serials CSV"
                    value={serialState[line.sku] ?? ""}
                    onChange={(event) =>
                      setSerialState((current) => ({
                        ...current,
                        [line.sku]: event.target.value,
                      }))
                    }
                    disabled={!canReceive}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    data-testid={`po-receive-qty-${line.sku}`}
                    className="ml-auto w-28 text-right"
                    type="number"
                    min={0}
                    step={1}
                    value={receiveState[line.sku] ?? 0}
                    onChange={(event) =>
                      setReceiveState((current) => ({
                        ...current,
                        [line.sku]: Number(event.target.value),
                      }))
                    }
                    disabled={!canReceive}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="receive-receiver-name">Receiver name</Label>
            <Input
              id="receive-receiver-name"
              placeholder="Who received this?"
              value={receiverName}
              onChange={(event) => setReceiverName(event.target.value)}
            />
            {typeof userId === "number" ? (
              <p className="text-xs text-muted-foreground">
                Signed-in user #{userId} is recorded as <span className="font-medium">receiverUserId</span> on the GRN /
                stock movement.
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="receive-location">Warehouse location</Label>
            <Input
              id="receive-location"
              placeholder="Aisle/Bin/Location"
              value={warehouseLocation}
              onChange={(event) => setWarehouseLocation(event.target.value)}
            />
          </div>
        </div>

        {receiveError ? (
          <div
            data-testid="po-receive-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {receiveError}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
            <Button data-testid="po-receive-submit-button" onClick={onSubmitReceive} disabled={!canReceive || receiving}>
              <Truck className="mr-2 h-4 w-4" />
              Receive selected
            </Button>
          </Can>
        </div>
      </CardContent>
    </Card>
  );
}
