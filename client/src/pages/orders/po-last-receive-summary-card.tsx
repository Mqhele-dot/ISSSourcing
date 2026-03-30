import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PurchaseReceiveResult } from "@/api/client";

export function PoLastReceiveSummaryCard({ summary }: { summary: PurchaseReceiveResult }) {
  return (
    <Card id="po-last-receive" className="scroll-mt-36">
      <CardHeader>
        <CardTitle>What changed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Inventory deltas</Label>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.inventoryChanges.map((change, index) => (
                <TableRow key={`${change.sku}-${index}`}>
                  <TableCell>{change.sku}</TableCell>
                  <TableCell>{change.location}</TableCell>
                  <TableCell className="text-right">+{change.delta}</TableCell>
                  <TableCell className="text-right">{change.onHand}</TableCell>
                  <TableCell className="text-right">{change.available}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <Label>Shipment updates</Label>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shipment ID</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.shipmentUpdates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-sm text-muted-foreground">
                    No linked shipment changes
                  </TableCell>
                </TableRow>
              ) : (
                summary.shipmentUpdates.map((update) => (
                  <TableRow key={update.shipmentId}>
                    <TableCell>{update.shipmentId}</TableCell>
                    <TableCell>{update.toStatus}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
