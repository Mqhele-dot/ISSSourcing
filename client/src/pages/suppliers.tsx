import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Check, Edit, Phone, Mail, MapPin, Trash2, Plus, User, ExternalLink } from "lucide-react";
import { type Supplier, type SupplierForm, type SupplierLogo } from "@shared/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import TutorialStep from "@/components/ui/tutorial-button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const supplierFormSchema = z.object({
  name: z.string().min(2, "Supplier name must be at least 2 characters"),
  contactName: z.string().nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type SupplierLogoForm = {
  logoUrl: string;
};

export default function SuppliersPage() {
  const { toast } = useToast();
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");

  // Get all suppliers
  const { data: suppliers, isLoading } = useQuery({
    queryKey: ['/api/suppliers'],
    retry: 1,
  });

  // Get logo for selected supplier
  const { data: selectedLogo, isLoading: isLogoLoading } = useQuery({
    queryKey: ['/api/suppliers', selectedSupplierId, 'logo'],
    queryFn: () => 
      selectedSupplierId 
        ? apiRequest(`/api/suppliers/${selectedSupplierId}/logo`) 
        : Promise.resolve(null),
    enabled: !!selectedSupplierId,
    retry: 0,
  });

  // Create supplier
  const createSupplier = useMutation({
    mutationFn: (supplier: SupplierForm) => 
      apiRequest('/api/suppliers', { method: 'POST', data: supplier }),
    onSuccess: () => {
      toast({
        title: "Supplier created",
        description: "The supplier has been added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
    },
    onError: (error) => {
      toast({
        title: "Error creating supplier",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Update supplier
  const updateSupplier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierForm> }) => 
      apiRequest(`/api/suppliers/${id}`, { method: 'PATCH', data }),
    onSuccess: (_, variables) => {
      toast({
        title: "Supplier updated",
        description: "The supplier has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.id] });
    },
    onError: (error) => {
      toast({
        title: "Error updating supplier",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete supplier
  const deleteSupplier = useMutation({
    mutationFn: (id: number) => 
      apiRequest(`/api/suppliers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({
        title: "Supplier deleted",
        description: "The supplier has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      setSelectedSupplierId(null);
    },
    onError: (error) => {
      toast({
        title: "Error deleting supplier",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Create logo
  const createLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => 
      apiRequest(`/api/suppliers/${supplierId}/logo`, { 
        method: 'POST', 
        data: { logoUrl } 
      }),
    onSuccess: (_, variables) => {
      toast({
        title: "Logo added",
        description: "The supplier logo has been added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.supplierId, 'logo'] });
      setLogoDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error adding logo",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Update logo
  const updateLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => 
      apiRequest(`/api/suppliers/${supplierId}/logo`, { 
        method: 'PUT', 
        data: { logoUrl } 
      }),
    onSuccess: (_, variables) => {
      toast({
        title: "Logo updated",
        description: "The supplier logo has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.supplierId, 'logo'] });
      setLogoDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error updating logo",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete logo
  const deleteLogo = useMutation({
    mutationFn: (supplierId: number) => 
      apiRequest(`/api/suppliers/${supplierId}/logo`, { method: 'DELETE' }),
    onSuccess: (_, supplierId) => {
      toast({
        title: "Logo removed",
        description: "The supplier logo has been removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', supplierId, 'logo'] });
    },
    onError: (error) => {
      toast({
        title: "Error removing logo",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Create or update supplier form
  const form = useForm<SupplierForm>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
    },
  });

  // Logo form
  const logoForm = useForm<SupplierLogoForm>({
    defaultValues: {
      logoUrl: "",
    },
  });

  // Edit supplier
  const handleEditSupplier = (supplier: Supplier) => {
    form.reset({
      name: supplier.name,
      contactName: supplier.contactName || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      notes: supplier.notes || "",
    });
    setSelectedSupplierId(supplier.id);
  };

  // Create supplier
  const handleCreateSupplier = (data: SupplierForm) => {
    createSupplier.mutate(data);
    form.reset();
  };

  // Update supplier
  const handleUpdateSupplier = (data: SupplierForm) => {
    if (selectedSupplierId) {
      updateSupplier.mutate({ id: selectedSupplierId, data });
      setSelectedSupplierId(null);
      form.reset();
    }
  };

  // Delete supplier
  const handleDeleteSupplier = (id: number) => {
    if (confirm("Are you sure you want to delete this supplier? This action cannot be undone.")) {
      deleteSupplier.mutate(id);
    }
  };

  // Handle logo form submission
  const handleLogoSubmit = (data: SupplierLogoForm) => {
    if (!selectedSupplierId) return;
    
    if (selectedLogo) {
      updateLogo.mutate({ supplierId: selectedSupplierId, logoUrl: data.logoUrl });
    } else {
      createLogo.mutate({ supplierId: selectedSupplierId, logoUrl: data.logoUrl });
    }
  };

  // Open logo dialog
  const handleOpenLogoDialog = (supplier: Supplier) => {
    setSelectedSupplierId(supplier.id);
    setLogoDialogOpen(true);
    
    // Reset form with existing logo URL if available
    if (selectedLogo) {
      logoForm.reset({ logoUrl: selectedLogo.logoUrl });
    } else {
      logoForm.reset({ logoUrl: "" });
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage your suppliers and their information
          </p>
        </div>
        <TutorialStep page="suppliers" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Supplier List */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Supplier List</CardTitle>
            <CardDescription>View and manage your suppliers</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center space-x-4 p-4 border rounded-md">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            ) : suppliers && suppliers.length > 0 ? (
              <ScrollArea className="h-[500px]">
                <div className="space-y-4">
                  {suppliers.map((supplier: Supplier) => (
                    <div 
                      key={supplier.id} 
                      className="flex flex-col p-4 border rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <div className="flex justify-between">
                        <div className="flex items-center">
                          {/* Logo or placeholder */}
                          <div className="mr-4 h-12 w-12 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center overflow-hidden">
                            {supplier.id === selectedSupplierId && selectedLogo ? (
                              <img 
                                src={selectedLogo.logoUrl} 
                                alt={`${supplier.name} logo`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <User className="h-6 w-6 text-neutral-400" />
                            )}
                          </div>
                          <div>
                            <h3 className="font-medium">{supplier.name}</h3>
                            {supplier.contactName && (
                              <p className="text-sm text-muted-foreground">{supplier.contactName}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleOpenLogoDialog(supplier)}
                          >
                            Logo
                          </Button>
                          <Button 
                            variant="outline" 
                            size="icon"
                            onClick={() => handleEditSupplier(supplier)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="text-red-500 hover:text-red-600"
                            onClick={() => handleDeleteSupplier(supplier.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* Contact details */}
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        {supplier.email && (
                          <div className="flex items-center">
                            <Mail className="h-4 w-4 mr-2 text-muted-foreground" />
                            <a href={`mailto:${supplier.email}`} className="text-blue-500 hover:underline">
                              {supplier.email}
                            </a>
                          </div>
                        )}
                        {supplier.phone && (
                          <div className="flex items-center">
                            <Phone className="h-4 w-4 mr-2 text-muted-foreground" />
                            <a href={`tel:${supplier.phone}`} className="text-blue-500 hover:underline">
                              {supplier.phone}
                            </a>
                          </div>
                        )}
                        {supplier.address && (
                          <div className="flex items-center col-span-2">
                            <MapPin className="h-4 w-4 mr-2 text-muted-foreground flex-shrink-0" />
                            <span>{supplier.address}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Notes */}
                      {supplier.notes && (
                        <div className="mt-3 pt-3 border-t text-sm">
                          <p className="text-muted-foreground">{supplier.notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No suppliers found</p>
                <p className="text-sm text-muted-foreground mt-1">Get started by adding a supplier</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add/Edit Supplier Form */}
        <Card>
          <CardHeader>
            <CardTitle>{selectedSupplierId ? "Edit Supplier" : "Add New Supplier"}</CardTitle>
            <CardDescription>
              {selectedSupplierId 
                ? "Update supplier information" 
                : "Create a new supplier for your inventory"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(
                  selectedSupplierId ? handleUpdateSupplier : handleCreateSupplier
                )}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name*</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter company name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter contact name" {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input placeholder="email@example.com" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="(555) 123-4567" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St, Anytown, ST 12345" {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Additional information about this supplier" 
                          className="min-h-[100px]" 
                          {...field} 
                          value={field.value || ""} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-between pt-2">
                  {selectedSupplierId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSelectedSupplierId(null);
                        form.reset();
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button 
                    type="submit" 
                    className={selectedSupplierId ? "" : "w-full"}
                    disabled={createSupplier.isPending || updateSupplier.isPending}
                  >
                    {createSupplier.isPending || updateSupplier.isPending ? (
                      <span>Saving...</span>
                    ) : selectedSupplierId ? (
                      <span>Update Supplier</span>
                    ) : (
                      <span>Add Supplier</span>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* Logo Dialog */}
      <Dialog open={logoDialogOpen} onOpenChange={setLogoDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Supplier Logo</DialogTitle>
            <DialogDescription>
              {selectedLogo 
                ? "Update the logo for this supplier" 
                : "Add a logo URL for this supplier"
              }
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={logoForm.handleSubmit(handleLogoSubmit)}>
            {/* Logo preview */}
            {selectedLogo && (
              <div className="flex justify-center mb-4">
                <div className="h-24 w-24 border rounded-md overflow-hidden">
                  <img 
                    src={selectedLogo.logoUrl} 
                    alt="Supplier logo" 
                    className="h-full w-full object-contain"
                  />
                </div>
              </div>
            )}
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="logoUrl">Logo URL</Label>
                <Input
                  id="logoUrl"
                  placeholder="https://example.com/logo.png"
                  {...logoForm.register('logoUrl')}
                />
                <p className="text-sm text-muted-foreground">
                  Enter a URL for the supplier's logo image
                </p>
              </div>
              
              <div className="flex justify-between">
                {selectedLogo && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (selectedSupplierId && confirm("Are you sure you want to remove this logo?")) {
                        deleteLogo.mutate(selectedSupplierId);
                        setLogoDialogOpen(false);
                      }
                    }}
                  >
                    Remove Logo
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLogoDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">
                    {selectedLogo ? "Update Logo" : "Add Logo"}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}