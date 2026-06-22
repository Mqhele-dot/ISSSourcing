import { Link } from "wouter";
import { Pencil, MoreHorizontal, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Can } from "@/components/auth/can";
import type { Warehouse } from "@/pages/warehouses/warehouse-types";

type WarehouseTableProps = {
  list: Warehouse[];
  onEdit: (warehouse: Warehouse) => void;
  onDelete: (warehouse: Warehouse) => void;
};

export function WarehouseTable({ list, onEdit, onDelete }: WarehouseTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Aisles / Bins</TableHead>
          <TableHead>Contact Person</TableHead>
          <TableHead>Contact Phone</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((warehouse) => {
          const aisles = warehouse.aisles ?? [];
          const bins = warehouse.bins ?? [];
          const aisleBinSummary = [
            Array.isArray(aisles) && aisles.length > 0 ? `${aisles.length} aisle(s)` : null,
            Array.isArray(bins) && bins.length > 0 ? `${bins.length} bin(s)` : null,
          ]
            .filter(Boolean)
            .join(", ") || "—";
          return (
            <TableRow key={warehouse.id}>
              <TableCell className="font-medium">
                <Link href={`/warehouses/${warehouse.id}`} className="hover:underline">
                  {warehouse.name}
                </Link>
              </TableCell>
              <TableCell>{warehouse.location || warehouse.address || "—"}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{aisleBinSummary}</TableCell>
              <TableCell>{warehouse.contactPerson || "—"}</TableCell>
              <TableCell>{warehouse.contactPhone || "—"}</TableCell>
              <TableCell>
                {warehouse.isDefault && (
                  <Badge variant="outline" className="bg-primary/10 text-primary">
                    Default
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit or delete warehouses">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onEdit(warehouse)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(warehouse)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Can>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
