import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, requestJson } from "@/lib/queryClient";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Check, Edit, Phone, Mail, MapPin, Trash2, Plus, User, ExternalLink } from "lucide-react";
import { type Supplier, type SupplierLogo } from "@shared/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import TutorialStep from "@/components/ui/tutorial-button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Can } from "@/components/auth/can";
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
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";

const supplierFormSchema = z.object({
  name: z.string().min(2, "Supplier name must be at least 2 characters"),
  contactName: z.string().nullable().optional(),
  email: z.string().email("Invalid email address").nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  taxIdentificationNumber: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  bankAccountNumber: z.string().nullable().optional(),
  bankSwift: z.string().nullable().optional(),
  paymentTermsId: z.number().int().positive().nullable().optional(),
  defaultCurrencyCode: z.string().nullable().optional(),
  insuranceExpiry: z.string().nullable().optional(),
  complianceNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

type SupplierLogoForm = {
  logoUrl: string;
};

export default function SuppliersPage() {
  const { toast } = useToast();
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [logoDialogOpen, setLogoDialogOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [deleteConfirmSupplier, setDeleteConfirmSupplier] = useState<Supplier | null>(null);
  const [removeLogoConfirm, setRemoveLogoConfirm] = useState(false);

  // Get all suppliers
  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ['/api/suppliers'],
    retry: 1,
  });

  const { data: paymentTerms = [] } = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["/api/payment-terms"],
    queryFn: () => requestJson("GET", "/api/payment-terms"),
  });

  const { data: currencies = [] } = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["/api/currencies"],
    queryFn: () => requestJson("GET", "/api/currencies"),
  });
  const { data: performance = [] } = useQuery<
    Array<{
      supplierId: number;
      supplierName: string;
      onTimeDeliveryRate: number;
      priceComplianceRate: number;
      ordersMeasured: number;
      invoicesMeasured: number;
      overallRating: number;
    }>
  >({
    queryKey: ["/api/suppliers/performance"],
    queryFn: () => requestJson("GET", "/api/suppliers/performance"),
  });

  // Get logo for selected supplier
  const { data: selectedLogo, isLoading: isLogoLoading } = useQuery<SupplierLogo | null>({
    queryKey: ['/api/suppliers', selectedSupplierId, 'logo'],
    queryFn: async () => {
      if (!selectedSupplierId) {
        return null;
      }
      try {
        return await requestJson<SupplierLogo>("GET", `/api/suppliers/${selectedSupplierId}/logo`);
      } catch {
        return null;
      }
    },
    enabled: !!selectedSupplierId,
    retry: 0,
  });

  // Create supplier
  const createSupplier = useMutation({
    mutationFn: (supplier: SupplierFormValues) => 
      requestJson<Supplier>('POST', '/api/suppliers', supplier),
    onSuccess: () => {
      toast({
        title: "Supplier created",
        description: "The supplier has been added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
    },
    onError: (error, data) => {
      toast({
        title: "Error creating supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: data && (
          <ToastAction altText="Retry" onClick={() => createSupplier.mutate(data)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Update supplier
  const updateSupplier = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierFormValues> }) => 
      requestJson<Supplier>('PATCH', `/api/suppliers/${id}`, data),
    onSuccess: (_, variables) => {
      toast({
        title: "Supplier updated",
        description: "The supplier has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.id] });
    },
    onError: (error, vars) => {
      toast({
        title: "Error updating supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => updateSupplier.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Delete supplier
  const deleteSupplier = useMutation({
    mutationFn: (id: number) => 
      requestJson<{ success: boolean }>('DELETE', `/api/suppliers/${id}`),
    onSuccess: () => {
      toast({
        title: "Supplier deleted",
        description: "The supplier has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      setSelectedSupplierId(null);
    },
    onError: (error, id) => {
      toast({
        title: "Error deleting supplier",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: id != null ? (
          <ToastAction altText="Retry" onClick={() => deleteSupplier.mutate(id)}>
            Retry
          </ToastAction>
        ) : undefined,
      });
    },
  });

  // Create logo
  const createLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => 
      requestJson<SupplierLogo>('POST', `/api/suppliers/${supplierId}/logo`, { logoUrl }),
    onSuccess: (_, variables) => {
      toast({
        title: "Logo added",
        description: "The supplier logo has been added successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.supplierId, 'logo'] });
      setLogoDialogOpen(false);
    },
    onError: (error, vars) => {
      toast({
        title: "Error adding logo",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => createLogo.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Update logo
  const updateLogo = useMutation({
    mutationFn: ({ supplierId, logoUrl }: { supplierId: number; logoUrl: string }) => 
      requestJson<SupplierLogo>('PUT', `/api/suppliers/${supplierId}/logo`, { logoUrl }),
    onSuccess: (_, variables) => {
      toast({
        title: "Logo updated",
        description: "The supplier logo has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', variables.supplierId, 'logo'] });
      setLogoDialogOpen(false);
    },
    onError: (error, vars) => {
      toast({
        title: "Error updating logo",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => updateLogo.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  // Delete logo
  const deleteLogo = useMutation({
    mutationFn: (supplierId: number) => 
      requestJson<{ success: boolean }>('DELETE', `/api/suppliers/${supplierId}/logo`),
    onSuccess: (_, supplierId) => {
      toast({
        title: "Logo removed",
        description: "The supplier logo has been removed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers', supplierId, 'logo'] });
    },
    onError: (error, supplierId) => {
      toast({
        title: "Error removing logo",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
        action: supplierId != null ? (
          <ToastAction altText="Retry" onClick={() => deleteLogo.mutate(supplierId)}>
            Retry
          </ToastAction>
        ) : undefined,
      });
    },
  });

  // Create or update supplier form
  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      taxIdentificationNumber: "",
      bankName: "",
      bankAccountNumber: "",
      bankSwift: "",
      paymentTermsId: null,
      defaultCurrencyCode: "",
      insuranceExpiry: "",
      complianceNotes: "",
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
      taxIdentificationNumber: (supplier as { taxIdentificationNumber?: string }).taxIdentificationNumber || "",
      bankName: (supplier as { bankName?: string | null }).bankName || "",
      bankAccountNumber: (supplier as { bankAccountNumber?: string | null }).bankAccountNumber || "",
      bankSwift: (supplier as { bankSwift?: string | null }).bankSwift || "",
      paymentTermsId: (supplier as { paymentTermsId?: number | null }).paymentTermsId ?? null,
      defaultCurrencyCode: (supplier as { defaultCurrencyCode?: string | null }).defaultCurrencyCode || "",
      insuranceExpiry: ((supplier as { insuranceExpiry?: Date | string | null }).insuranceExpiry
        ? new Date((supplier as { insuranceExpiry?: Date | string | null }).insuranceExpiry as Date | string)
            .toISOString()
            .slice(0, 10)
        : ""),
      complianceNotes: (supplier as { complianceNotes?: string | null }).complianceNotes || "",
      notes: supplier.notes || "",
    });
    setSelectedSupplierId(supplier.id);
  };

  const toSupplierPayload = (data: SupplierFormValues): SupplierFormValues => ({
    ...data,
    contactName: data.contactName?.trim() || null,
    email: data.email?.trim() || null,
    phone: data.phone?.trim() || null,
    address: data.address?.trim() || null,
    taxIdentificationNumber: data.taxIdentificationNumber?.trim() || null,
    bankName: data.bankName?.trim() || null,
    bankAccountNumber: data.bankAccountNumber?.trim() || null,
    bankSwift: data.bankSwift?.trim() || null,
    paymentTermsId: data.paymentTermsId ?? null,
    defaultCurrencyCode: data.defaultCurrencyCode?.trim() || null,
    insuranceExpiry: data.insuranceExpiry?.trim() || null,
    complianceNotes: data.complianceNotes?.trim() || null,
    notes: data.notes?.trim() || null,
  });

  // Create supplier
  const handleCreateSupplier = (data: SupplierFormValues) => {
    createSupplier.mutate(toSupplierPayload(data));
    form.reset();
  };

  // Update supplier
  const handleUpdateSupplier = (data: SupplierFormValues) => {
    if (selectedSupplierId) {
      updateSupplier.mutate({ id: selectedSupplierId, data: toSupplierPayload(data) });
      setSelectedSupplierId(null);
      form.reset();
    }
  };

  // Delete supplier (confirmation via AlertDialog)
  const handleDeleteSupplier = (supplier: Supplier) => {
    setDeleteConfirmSupplier(supplier);
  };
  const confirmDeleteSupplier = () => {
    if (!deleteConfirmSupplier) return;
    deleteSupplier.mutate(deleteConfirmSupplier.id, {
      onSettled: () => setDeleteConfirmSupplier(null),
    });
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

  const paymentTermsById = new Map(paymentTerms.map((term) => [term.id, `${term.code} - ${term.name}`]));
  const performanceBySupplier = new Map(performance.map((row) => [row.supplierId, row]));

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
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit suppliers">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleOpenLogoDialog(supplier)}
                            >
                              Logo
                            </Button>
                          </Can>
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit suppliers">
                            <Button 
                              variant="outline" 
                              size="icon"
                              onClick={() => handleEditSupplier(supplier)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </Can>
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to delete suppliers">
                            <Button 
                              variant="outline" 
                              size="icon" 
                              className="text-red-500 hover:text-red-600"
                              onClick={() => handleDeleteSupplier(supplier)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Can>
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
                        {(supplier as { taxIdentificationNumber?: string }).taxIdentificationNumber && (
                          <div className="flex items-center col-span-2">
                            <span className="text-muted-foreground text-sm">Tax ID:</span>
                            <span className="ml-2">{(supplier as { taxIdentificationNumber: string }).taxIdentificationNumber}</span>
                          </div>
                        )}
                        {(supplier as { bankName?: string | null }).bankName && (
                          <div className="flex items-center col-span-2">
                            <span className="text-muted-foreground text-sm">Bank:</span>
                            <span className="ml-2">{(supplier as { bankName: string }).bankName}</span>
                          </div>
                        )}
                        {(supplier as { defaultCurrencyCode?: string | null }).defaultCurrencyCode && (
                          <div className="flex items-center col-span-2">
                            <span className="text-muted-foreground text-sm">Default currency:</span>
                            <span className="ml-2">{(supplier as { defaultCurrencyCode: string }).defaultCurrencyCode}</span>
                          </div>
                        )}
                        {(supplier as { paymentTermsId?: number | null }).paymentTermsId && (
                          <div className="flex items-center col-span-2">
                            <span className="text-muted-foreground text-sm">Payment terms:</span>
                            <span className="ml-2">
                              {paymentTermsById.get((supplier as { paymentTermsId: number }).paymentTermsId) ??
                                `Term #${(supplier as { paymentTermsId: number }).paymentTermsId}`}
                            </span>
                          </div>
                        )}
                        {performanceBySupplier.get(supplier.id) ? (
                          <div className="flex items-center col-span-2">
                            <span className="text-muted-foreground text-sm">Supplier rating:</span>
                            <span className="ml-2">
                              {performanceBySupplier.get(supplier.id)?.overallRating.toFixed(1)}/5
                              {" · "}
                              OTD {performanceBySupplier.get(supplier.id)?.onTimeDeliveryRate.toFixed(1)}%
                              {" · "}
                              Price compliance {performanceBySupplier.get(supplier.id)?.priceComplianceRate.toFixed(1)}%
                            </span>
                          </div>
                        ) : null}
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

        {/* Add/Edit Supplier Form — manager/admin only */}
        <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add or edit suppliers">
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
                aria-label="Supplier form"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="supplier-name">Company Name*</FormLabel>
                      <FormControl>
                        <Input id="supplier-name" aria-label="Company name" placeholder="Enter company name" {...field} />
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
                      <FormLabel htmlFor="supplier-contact">Contact Person</FormLabel>
                      <FormControl>
                        <Input id="supplier-contact" aria-label="Contact person" placeholder="Enter contact name" {...field} value={field.value || ""} />
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
                        <FormLabel htmlFor="supplier-email">Email</FormLabel>
                        <FormControl>
                          <Input id="supplier-email" aria-label="Email" placeholder="email@example.com" {...field} value={field.value || ""} />
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
                        <FormLabel htmlFor="supplier-phone">Phone</FormLabel>
                        <FormControl>
                          <Input id="supplier-phone" aria-label="Phone" placeholder="(555) 123-4567" {...field} value={field.value || ""} />
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
                      <FormLabel htmlFor="supplier-address">Address</FormLabel>
                      <FormControl>
                        <Input id="supplier-address" aria-label="Address" placeholder="123 Main St, Anytown, ST 12345" {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="taxIdentificationNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="supplier-taxid">Tax ID / VAT number</FormLabel>
                      <FormControl>
                        <Input id="supplier-taxid" aria-label="Tax ID or VAT number" placeholder="e.g. VAT number, tax registration" {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="bankName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-bank-name">Bank name</FormLabel>
                        <FormControl>
                          <Input id="supplier-bank-name" aria-label="Bank name" placeholder="Bank name" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bankAccountNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-bank-account">Bank account number</FormLabel>
                        <FormControl>
                          <Input id="supplier-bank-account" aria-label="Bank account number" placeholder="Account number" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="bankSwift"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-bank-swift">SWIFT/BIC</FormLabel>
                        <FormControl>
                          <Input id="supplier-bank-swift" aria-label="Bank SWIFT or BIC code" placeholder="SWIFT/BIC code" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="paymentTermsId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-payment-terms">Payment terms</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value ? String(field.value) : "none"}
                            onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}
                          >
                            <SelectTrigger id="supplier-payment-terms" aria-label="Supplier payment terms">
                              <SelectValue placeholder="Select payment terms" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {paymentTerms.map((term) => (
                                <SelectItem key={term.id} value={String(term.id)}>
                                  {term.code} - {term.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="defaultCurrencyCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-default-currency">Default currency</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value || "none"}
                            onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                          >
                            <SelectTrigger id="supplier-default-currency" aria-label="Supplier default currency">
                              <SelectValue placeholder="Select default currency" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {currencies.map((currency) => (
                                <SelectItem key={currency.id} value={currency.code}>
                                  {currency.code} - {currency.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="insuranceExpiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-insurance-expiry">Insurance expiry</FormLabel>
                        <FormControl>
                          <Input id="supplier-insurance-expiry" aria-label="Insurance expiry date" type="date" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="complianceNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="supplier-compliance-notes">Compliance notes</FormLabel>
                      <FormControl>
                        <Textarea
                          id="supplier-compliance-notes"
                          aria-label="Supplier compliance notes"
                          placeholder="Certifications, insurance notes, compliance remarks"
                          className="min-h-[80px]"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="supplier-notes">Notes</FormLabel>
                      <FormControl>
                        <Textarea 
                          id="supplier-notes"
                          aria-label="Supplier notes"
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
        </Can>
      </div>

      <div className="mt-6">
        <EntityDocumentsCard
          entityType="supplier"
          entityId={selectedSupplierId}
          title="Supplier Compliance Documents"
        />
      </div>

      {/* Remove logo confirmation */}
      <AlertDialog open={removeLogoConfirm} onOpenChange={(open) => !open && setRemoveLogoConfirm(false)}>
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

      {/* Delete supplier confirmation */}
      <AlertDialog open={!!deleteConfirmSupplier} onOpenChange={(open) => !open && setDeleteConfirmSupplier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmSupplier
                ? `This will permanently remove "${deleteConfirmSupplier.name}". This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteSupplier}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    onClick={() => setRemoveLogoConfirm(true)}
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