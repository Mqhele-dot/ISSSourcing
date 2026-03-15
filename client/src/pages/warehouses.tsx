import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest, unwrapOperationalResponse } from '@/lib/queryClient';
import { Plus, Pencil, MoreHorizontal, Trash2, Loader2, Building } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';

// Warehouse interface (API returns ISO date strings, not Date objects)
interface Warehouse {
  id: number;
  name: string;
  address: string | null;
  location: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  isDefault: boolean | null;
  aisle?: string | null;
  aisles?: string[] | null;
  bins?: { code: string; aisle?: string; row?: string; shelf?: string }[] | null;
  locationDetails?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface BinLocation {
  code: string;
  aisle?: string;
  row?: string;
  shelf?: string;
}

interface FormData {
  name: string;
  address: string;
  location: string;
  contactPerson: string;
  contactPhone: string;
  isDefault: boolean;
  aisles: string;
  bins: BinLocation[];
  locationDetails: string;
}

/** Centralized validation for create/edit. Returns error message or null if valid. */
function validateWarehouseForm(data: FormData): string | null {
  if (!data.name.trim()) return "Warehouse name is required";
  return null;
}

export default function WarehousesPage() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    address: '',
    location: '',
    contactPerson: '',
    contactPhone: '',
    isDefault: false,
    aisles: '',
    bins: [],
    locationDetails: '',
  });

  // Fetch warehouses (response may include meta.fallback when server used fallback)
  const { data: warehousesRaw, isLoading, error } = useQuery<
    Warehouse[] | { data: Warehouse[]; meta: { fallback?: string } }
  >({
    queryKey: ['/api/warehouses'],
  });
  const { data: warehouseList, fallback: listFallback } = unwrapOperationalResponse(
    warehousesRaw ?? [],
  );
  const list = Array.isArray(warehouseList) ? warehouseList : [];

  // Create warehouse mutation
  const createWarehouse = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest('POST', '/api/warehouses', data);
      return await res.json();
    },
    onSuccess: (_data, variables) => {
      const createdName = variables.name.trim();
      queryClient.invalidateQueries({ queryKey: ['/api/warehouses'] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({
        title: 'Warehouse created',
        description: 'Warehouse has been created successfully',
      });
      // Post-create verification: if refetched list doesn't include the new item, warn
      queryClient.fetchQuery({ queryKey: ['/api/warehouses'] }).then((list: unknown) => {
        const arr = Array.isArray(list) ? list : [];
        if (!arr.some((w: { name?: string }) => w.name === createdName)) {
          toast({
            variant: 'destructive',
            title: 'Created but not visible yet',
            description: 'Check backend persistence.',
          });
        }
      }).catch(() => {});
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create warehouse (POST /api/warehouses)',
        description: error.message,
      });
    },
  });

  // Update warehouse mutation
  const updateWarehouse = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest('PATCH', `/api/warehouses/${id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouses'] });
      setIsEditDialogOpen(false);
      setSelectedWarehouse(null);
      toast({
        title: 'Warehouse updated',
        description: 'Warehouse has been updated successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: `Failed to update warehouse (PATCH /api/warehouses/${selectedWarehouse?.id ?? '?'})`,
        description: error.message,
      });
    },
  });

  // Delete warehouse mutation
  const deleteWarehouse = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest('DELETE', `/api/warehouses/${id}`);
      if (res.ok) return true;
      throw new Error('Failed to delete warehouse');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouses'] });
      setIsDeleteDialogOpen(false);
      setSelectedWarehouse(null);
      toast({
        title: 'Warehouse deleted',
        description: 'Warehouse has been deleted successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: `Failed to delete warehouse (DELETE /api/warehouses/${selectedWarehouse?.id ?? '?'})`,
        description: error.message,
      });
    },
  });

  const toPayload = (data: FormData) => {
    const aisles = data.aisles
      ? data.aisles.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const bins = data.bins.filter((b) => b.code.trim()).map((b) => ({
      code: b.code.trim(),
      aisle: b.aisle?.trim() || undefined,
      row: b.row?.trim() || undefined,
      shelf: b.shelf?.trim() || undefined,
    }));
    let locationDetails: Record<string, unknown> | null = null;
    if (data.locationDetails.trim()) {
      try {
        locationDetails = JSON.parse(data.locationDetails) as Record<string, unknown>;
      } catch {
        locationDetails = { raw: data.locationDetails };
      }
    }
    return {
      name: data.name.trim(),
      address: data.address || null,
      location: data.location || null,
      contactPerson: data.contactPerson || null,
      contactPhone: data.contactPhone || null,
      isDefault: data.isDefault,
      aisles: aisles.length ? aisles : undefined,
      bins: bins.length ? bins : undefined,
      locationDetails: locationDetails ?? undefined,
    };
  };

  const handleCreateSubmit = () => {
    const err = validateWarehouseForm(formData);
    if (err) {
      toast({
        variant: 'destructive',
        title: 'Validation',
        description: err,
      });
      return;
    }
    createWarehouse.mutate(toPayload(formData) as FormData);
  };

  const handleEditSubmit = () => {
    if (!selectedWarehouse) return;
    const err = validateWarehouseForm(formData);
    if (err) {
      toast({
        variant: 'destructive',
        title: 'Validation',
        description: err,
      });
      return;
    }
    updateWarehouse.mutate({
      id: selectedWarehouse.id,
      data: toPayload(formData) as FormData,
    });
  };

  const handleDeleteConfirm = () => {
    if (selectedWarehouse) {
      deleteWarehouse.mutate(selectedWarehouse.id);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      address: '',
      location: '',
      contactPerson: '',
      contactPhone: '',
      isDefault: false,
      aisles: '',
      bins: [],
      locationDetails: '',
    });
  };

  const openEditDialog = (warehouse: Warehouse) => {
    setSelectedWarehouse(warehouse);
    const aislesList = warehouse.aisles ?? [];
    const details = warehouse.locationDetails;
    setFormData({
      name: warehouse.name,
      address: warehouse.address || '',
      location: warehouse.location || '',
      contactPerson: warehouse.contactPerson || '',
      contactPhone: warehouse.contactPhone || '',
      isDefault: warehouse.isDefault || false,
      aisles: Array.isArray(aislesList) ? aislesList.join(', ') : '',
      bins: (warehouse.bins ?? []).map((b) => (typeof b === 'object' ? b : { code: String(b), aisle: '', row: '', shelf: '' })),
      locationDetails: details && typeof details === 'object' ? JSON.stringify(details, null, 2) : (typeof details === 'string' ? details : ''),
    });
    setIsEditDialogOpen(true);
  };

  const addBin = () => {
    setFormData({ ...formData, bins: [...formData.bins, { code: '', aisle: '', row: '', shelf: '' }] });
  };

  const updateBin = (index: number, field: keyof BinLocation, value: string) => {
    const next = [...formData.bins];
    next[index] = { ...next[index], [field]: value };
    setFormData({ ...formData, bins: next });
  };

  const removeBin = (index: number) => {
    setFormData({ ...formData, bins: formData.bins.filter((_, i) => i !== index) });
  };

  const openDeleteDialog = (warehouse: Warehouse) => {
    setSelectedWarehouse(warehouse);
    setIsDeleteDialogOpen(true);
  };

  if (error) {
    return (
      <Alert variant="destructive" className="max-w-4xl mx-auto mt-4">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to load warehouses (GET /api/warehouses): {(error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Warehouses</h1>
          <p className="text-muted-foreground">
            Manage your warehouse locations and inventory distribution
          </p>
        </div>
        <Button onClick={() => {
          resetForm();
          setIsCreateDialogOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Warehouse
        </Button>
      </div>

      {listFallback ? (
        <Alert variant="default" className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTitle>Temporary data outage</AlertTitle>
          <AlertDescription>
            Data could not be loaded from the server. You may see empty or cached results. Try refreshing in a moment.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <Building className="h-12 w-12 text-gray-400 mb-4" />
              <h3 className="text-lg font-medium mb-2">No warehouses found</h3>
              <p className="text-muted-foreground mb-4 max-w-md">
                You haven't added any warehouses yet. Add your first warehouse to start managing inventory across multiple locations.
              </p>
              <Button onClick={() => {
                resetForm();
                setIsCreateDialogOpen(true);
              }}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Warehouse
              </Button>
            </div>
          ) : (
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
                  ].filter(Boolean).join(', ') || '—';
                  return (
                  <TableRow key={warehouse.id}>
                    <TableCell className="font-medium">{warehouse.name}</TableCell>
                    <TableCell>{warehouse.location || warehouse.address || '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{aisleBinSummary}</TableCell>
                    <TableCell>{warehouse.contactPerson || '—'}</TableCell>
                    <TableCell>{warehouse.contactPhone || '—'}</TableCell>
                    <TableCell>
                      {warehouse.isDefault && (
                        <Badge variant="outline" className="bg-primary/10 text-primary">
                          Default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
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
                          <DropdownMenuItem onClick={() => openEditDialog(warehouse)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => openDeleteDialog(warehouse)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Warehouse Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Warehouse</DialogTitle>
            <DialogDescription>
              Enter the details for the new warehouse location.
            </DialogDescription>
          </DialogHeader>
          {/* We use custom toast validation; native HTML validation is disabled. */}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSubmit();
            }}
          >
            <fieldset className="grid gap-4 py-4" disabled={createWarehouse.isPending}>
              <div className="grid gap-2">
                <Label htmlFor="name">Warehouse Name *</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Main Warehouse"
                  aria-required="true"
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Building A, Floor 2"
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Main Street, City, Country"
                  rows={2}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="contactPerson">Contact Person</Label>
                  <Input
                    id="contactPerson"
                    name="contactPerson"
                    value={formData.contactPerson}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contactPhone">Contact Phone</Label>
                  <Input
                    id="contactPhone"
                    name="contactPhone"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>
              
              <p className="text-sm font-medium text-muted-foreground pt-2 border-t">Aisles, Bins & Locations</p>
              <div className="grid gap-2">
                <Label htmlFor="aisles">Aisles (comma-separated)</Label>
                <Input
                  id="aisles"
                  value={formData.aisles}
                  onChange={(e) => setFormData({ ...formData, aisles: e.target.value })}
                  placeholder="A-1, A-2, B-1, B-2"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="locationDetails">Location details (optional JSON)</Label>
                <Textarea
                  id="locationDetails"
                  value={formData.locationDetails}
                  onChange={(e) => setFormData({ ...formData, locationDetails: e.target.value })}
                  placeholder='{"zone": "A", "floor": 1}'
                  rows={2}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">Add custom fields as JSON for zones, floors, etc.</p>
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label>Bins / Locations</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addBin}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add bin
                  </Button>
                </div>
                {formData.bins.map((bin, i) => (
                  <div key={i} className="flex gap-2 items-center p-2 border rounded-md">
                    <Input
                      placeholder="Code"
                      value={bin.code}
                      onChange={(e) => updateBin(i, 'code', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Aisle"
                      value={bin.aisle ?? ''}
                      onChange={(e) => updateBin(i, 'aisle', e.target.value)}
                      className="w-20"
                    />
                    <Input
                      placeholder="Row"
                      value={bin.row ?? ''}
                      onChange={(e) => updateBin(i, 'row', e.target.value)}
                      className="w-20"
                    />
                    <Input
                      placeholder="Shelf"
                      value={bin.shelf ?? ''}
                      onChange={(e) => updateBin(i, 'shelf', e.target.value)}
                      className="w-20"
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeBin(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center space-x-2 mt-2">
                <Switch
                  id="isDefault"
                  checked={formData.isDefault}
                  onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
                />
                <Label htmlFor="isDefault">Set as default warehouse</Label>
              </div>
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

      {/* Edit Warehouse Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Warehouse</DialogTitle>
            <DialogDescription>
              Update the warehouse details.
            </DialogDescription>
          </DialogHeader>
          {/* We use custom toast validation; native HTML validation is disabled. */}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              handleEditSubmit();
            }}
          >
            <fieldset className="grid gap-4 py-4" disabled={updateWarehouse.isPending}>
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Warehouse Name *</Label>
                <Input
                  id="edit-name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  aria-required="true"
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="edit-location">Location</Label>
                <Input
                  id="edit-location"
                  name="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                />
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="edit-address">Address</Label>
                <Textarea
                  id="edit-address"
                  name="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  rows={2}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-contactPerson">Contact Person</Label>
                  <Input
                    id="edit-contactPerson"
                    name="contactPerson"
                    value={formData.contactPerson}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-contactPhone">Contact Phone</Label>
                  <Input
                    id="edit-contactPhone"
                    name="contactPhone"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                  />
                </div>
              </div>
              
              <p className="text-sm font-medium text-muted-foreground pt-2 border-t">Aisles, Bins & Locations</p>
              <div className="grid gap-2">
                <Label htmlFor="edit-aisles">Aisles (comma-separated)</Label>
                <Input
                  id="edit-aisles"
                  value={formData.aisles}
                  onChange={(e) => setFormData({ ...formData, aisles: e.target.value })}
                  placeholder="A-1, A-2, B-1, B-2"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-locationDetails">Location details (optional JSON)</Label>
                <Textarea
                  id="edit-locationDetails"
                  value={formData.locationDetails}
                  onChange={(e) => setFormData({ ...formData, locationDetails: e.target.value })}
                  placeholder='{"zone": "A", "floor": 1}'
                  rows={2}
                  className="font-mono text-sm"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label>Bins / Locations</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addBin}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add bin
                  </Button>
                </div>
                {formData.bins.map((bin, i) => (
                  <div key={i} className="flex gap-2 items-center p-2 border rounded-md">
                    <Input
                      placeholder="Code"
                      value={bin.code}
                      onChange={(e) => updateBin(i, 'code', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Aisle"
                      value={bin.aisle ?? ''}
                      onChange={(e) => updateBin(i, 'aisle', e.target.value)}
                      className="w-20"
                    />
                    <Input
                      placeholder="Row"
                      value={bin.row ?? ''}
                      onChange={(e) => updateBin(i, 'row', e.target.value)}
                      className="w-20"
                    />
                    <Input
                      placeholder="Shelf"
                      value={bin.shelf ?? ''}
                      onChange={(e) => updateBin(i, 'shelf', e.target.value)}
                      className="w-20"
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeBin(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center space-x-2 mt-2">
                <Switch
                  id="edit-isDefault"
                  checked={formData.isDefault}
                  onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
                />
                <Label htmlFor="edit-isDefault">Set as default warehouse</Label>
              </div>
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

      {/* Delete Confirmation Dialog */}
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
                Deleting this warehouse will remove all associated inventory records. 
                Consider transferring inventory to another warehouse first.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteWarehouse.isPending}
            >
              {deleteWarehouse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Warehouse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}