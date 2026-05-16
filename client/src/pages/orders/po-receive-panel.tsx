import type { Dispatch, SetStateAction } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Can } from "@/components/auth/can";
import type { PurchaseOrderDetail } from "@/api/types";
import { normalizeReceiveQtyInput, type ReceiveLineFieldError } from "@/features/purchase-orders";

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
  /** Validation issues to show next to the affected line controls (submit-time only). */
  receiveLineIssues?: ReceiveLineFieldError[];
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
  receiveLineIssues = [],
  onSubmitReceive,
}: PoReceivePanelProps) {
  const issuesFor = (sku: string, field: ReceiveLineFieldError["field"]) =>
    receiveLineIssues.filter((i) => i.sku === sku && i.field === field);
  const globalLineIssues = receiveLineIssues.filter((i) => i.field === "_line");
  return (
    <Card id={sectionId} className={className} data-testid="po-receive-panel">
      <CardHeader>
        <CardTitle>Receive panel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {globalLineIssues.length > 0 ? (
          <div
            role="alert"
            aria-live="assertive"
            data-testid="po-receive-global-line-errors"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {globalLineIssues.map((iss, idx) => (
              <p key={`${iss.message}-${idx}`}>{iss.message}</p>
            ))}
          </div>
        ) : null}

        <Table>
          <TableCaption className="sr-only">
            Goods receipt lines for this purchase order. Enter batch, serial, and quantities to receive.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">SKU</TableHead>
              <TableHead scope="col">Item</TableHead>
              <TableHead scope="col">Supplier part #</TableHead>
              <TableHead scope="col">Commodity</TableHead>
              <TableHead scope="col" className="text-right">
                Ordered
              </TableHead>
              <TableHead scope="col" className="text-right">
                Received
              </TableHead>
              <TableHead scope="col" className="text-right">
                Remaining
              </TableHead>
              <TableHead scope="col">Batch</TableHead>
              <TableHead scope="col">Serial numbers</TableHead>
              <TableHead scope="col" className="text-right">
                Receive now
              </TableHead>
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
                    aria-label={`Batch number for ${line.sku}`}
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
                  {issuesFor(line.sku, "batchNumber").map((iss, idx) => (
                    <p key={idx} className="mt-1 text-xs text-destructive">
                      {iss.message}
                    </p>
                  ))}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Serial numbers for ${line.sku}, comma separated`}
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
                  {issuesFor(line.sku, "serialNumbers").map((iss, idx) => (
                    <p key={idx} className="mt-1 text-xs text-destructive">
                      {iss.message}
                    </p>
                  ))}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    aria-label={`Quantity to receive now for ${line.sku}`}
                    data-testid={`po-receive-qty-${line.sku}`}
                    className="ml-auto w-28 text-right"
                    type="number"
                    min={0}
                    step={1}
                    value={receiveState[line.sku] ?? 0}
                    onChange={(event) => {
                      const raw = normalizeReceiveQtyInput(event.target.value);
                      const next = Number.isFinite(raw) ? Math.trunc(raw) : 0;
                      setReceiveState((current) => ({
                        ...current,
                        [line.sku]: next,
                      }));
                    }}
                    disabled={!canReceive}
                  />
                  {issuesFor(line.sku, "qtyReceivedNow").map((iss, idx) => (
                    <p key={idx} className="mt-1 text-xs text-destructive">
                      {iss.message}
                    </p>
                  ))}
                  {issuesFor(line.sku, "sku").map((iss, idx) => (
                    <p key={idx} className="mt-1 text-xs text-destructive">
                      {iss.message}
                    </p>
                  ))}
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
            role="alert"
            aria-live="assertive"
            data-testid="po-receive-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {receiveError}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Can roles={["manager", "planner", "admin"]} reason="Requires Manager, Planner, or Admin">
            <Button
              data-testid="po-receive-submit-button"
              onClick={onSubmitReceive}
              disabled={!canReceive || receiving}
            >
              <Truck className="mr-2 h-4 w-4" />
              Receive selected
            </Button>
          </Can>
        </div>
      </CardContent>
    </Card>
  );
}
