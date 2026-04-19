import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import { ToastAction } from "@/components/ui/toast";
import { queryClient, apiRequest, requestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Calendar,
  DollarSign,
  Building2,
} from "lucide-react";
import type { SupplierContract, Supplier, SupplierContractForm } from "@shared/schema";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { supplierContractFormSchema } from "@shared/schema";
import { format } from "date-fns";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";
import { formatCurrency } from "@/lib/utils";

const CONTRACT_TYPES = ["master", "framework", "one-off", "renewal"] as const;
const STATUSES = ["draft", "active", "expired", "terminated"] as const;

export default function ContractsPage() {
  const { toast } = useToast();
  const { settings } = useSettings();
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [viewContract, setViewContract] = useState<SupplierContract | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirmContract, setDeleteConfirmContract] = useState<SupplierContract | null>(null);

  const { data: contracts = [], isLoading } = useQuery<SupplierContract[]>({
    queryKey: ["/api/contracts", supplierFilter],
    queryFn: async () => {
      const url = supplierFilter === "all" ? "/api/contracts" : `/api/contracts?supplierId=${supplierFilter}`;
      return requestJson("GET", url);
    },
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const defaultFormValues = useMemo((): Partial<SupplierContractForm> => {
    const code = settings.currencyCode?.trim() || "USD";
    return {
      supplierId: undefined,
      title: "",
      contractType: "master",
      referenceNumber: "",
      startDate: new Date(),
      endDate: undefined,
      value: undefined,
      currency: code,
      summary: "",
      status: "active",
      notes: "",
      attachments: [],
    };
  }, [settings.currencyCode]);

  const createContract = useMutation({
    mutationFn: (data: SupplierContractForm) => requestJson<SupplierContract>("POST", "/api/contracts", data),
    onSuccess: () => {
      toast({ title: "Contract created", description: "The contract has been added." });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setFormOpen(false);
      form.reset(defaultFormValues);
    },
    onError: (e, data) => {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to create contract",
        variant: "destructive",
        action: data && (
          <ToastAction altText="Retry" onClick={() => createContract.mutate(data)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  const updateContract = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SupplierContractForm> }) =>
      requestJson<SupplierContract>("PATCH", `/api/contracts/${id}`, data),
    onSuccess: () => {
      toast({ title: "Contract updated", description: "Changes have been saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setFormOpen(false);
      setEditingId(null);
      form.reset(defaultFormValues);
    },
    onError: (e, vars) => {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to update contract",
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => updateContract.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  const deleteContract = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contracts/${id}`),
    onSuccess: () => {
      toast({ title: "Contract deleted", description: "The contract has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setViewContract(null);
      setDeleteConfirmContract(null);
    },
    onError: (e, id) => {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Failed to delete contract",
        variant: "destructive",
        action: (
          <ToastAction altText="Retry" onClick={() => id != null && deleteContract.mutate(id)}>
            Retry
          </ToastAction>
        ),
      });
      setDeleteConfirmContract(null);
    },
  });

  const form = useForm<SupplierContractForm>({
    resolver: zodResolver(supplierContractFormSchema),
    defaultValues: defaultFormValues,
  });

  const openCreate = () => {
    setEditingId(null);
    form.reset({ ...defaultFormValues });
    setFormOpen(true);
  };

  const openEdit = (c: SupplierContract) => {
    setEditingId(c.id);
    form.reset({
      supplierId: c.supplierId,
      title: c.title,
      contractType: (c.contractType as SupplierContractForm["contractType"]) || "master",
      referenceNumber: c.referenceNumber ?? "",
      startDate: c.startDate,
      endDate: c.endDate ?? undefined,
      value: c.value ?? undefined,
      currency: c.currency ?? (settings.currencyCode?.trim() || "USD"),
      summary: c.summary ?? "",
      status: (c.status as SupplierContractForm["status"]) || "active",
      notes: c.notes ?? "",
      attachments: (c.attachments as { name: string; url: string }[]) ?? [],
    });
    setFormOpen(true);
  };

  const onSubmit = (data: SupplierContractForm) => {
    const attachments = (data.attachments ?? []).filter((a) => a?.url?.trim());
    const payload = {
      ...data,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      attachments: attachments.map((a) => ({ name: (a.name || "").trim() || "Link", url: a.url.trim() })),
    };
    if (editingId) {
      updateContract.mutate({ id: editingId, data: payload });
    } else {
      createContract.mutate(payload as SupplierContractForm);
    }
  };

  const getSupplierName = (id: number) => suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contract Management</h1>
          <p className="text-muted-foreground">
            Manage contracts with suppliers, view summaries, and find copies
          </p>
        </div>
        <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add contracts">
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Contract
          </Button>
        </Can>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle>Contracts</CardTitle>
              <CardDescription>All supplier contracts. Filter by supplier below.</CardDescription>
            </div>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading contracts…</div>
          ) : contracts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileText className="mx-auto h-12 w-12 opacity-50 mb-2" />
              <p>No contracts yet. Add one to get started.</p>
              <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add contracts">
                <Button variant="outline" className="mt-2" onClick={openCreate}>
                  Add Contract
                </Button>
              </Can>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start / End</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell>{getSupplierName(c.supplierId)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{c.contractType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.status === "active"
                            ? "default"
                            : c.status === "expired"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(c.startDate), "MMM d, yyyy")}
                      {c.endDate && ` – ${format(new Date(c.endDate), "MMM d, yyyy")}`}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setViewContract(c)}>
                        View
                      </Button>
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Can>
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to delete">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmContract(c)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* View contract detail */}
      <Dialog open={!!viewContract} onOpenChange={(open) => !open && setViewContract(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewContract?.title}</DialogTitle>
            <DialogDescription>Contract details and copies</DialogDescription>
          </DialogHeader>
          {viewContract && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{getSupplierName(viewContract.supplierId)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{viewContract.contractType}</Badge>
                <Badge
                  variant={
                    viewContract.status === "active"
                      ? "default"
                      : viewContract.status === "expired"
                      ? "destructive"
                      : "outline"
                  }
                >
                  {viewContract.status}
                </Badge>
                {viewContract.referenceNumber && (
                  <span className="text-sm text-muted-foreground">
                    Ref: {viewContract.referenceNumber}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(viewContract.startDate), "MMM d, yyyy")}
                  {viewContract.endDate &&
                    ` – ${format(new Date(viewContract.endDate), "MMM d, yyyy")}`}
                </span>
                {viewContract.value != null && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    {formatCurrency(
                      Number(viewContract.value),
                      viewContract.currency?.trim() || settings.currencyCode?.trim() || "USD",
                    )}
                  </span>
                )}
              </div>
              {viewContract.summary && (
                <div>
                  <Label className="text-muted-foreground">Summary</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{viewContract.summary}</p>
                </div>
              )}
              {viewContract.notes && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{viewContract.notes}</p>
                </div>
              )}
              {viewContract.attachments && viewContract.attachments.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Copies / Attachments</Label>
                  <ul className="mt-2 space-y-1">
                    {(viewContract.attachments as { name: string; url: string }[]).map((a, i) => (
                      <li key={i}>
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1 text-sm"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {a.name || "Link"}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <EntityDocumentsCard
                entityType="contract"
                entityId={viewContract.id}
                title="Contract Documents"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => viewContract && setViewContract(null)}>
              Close
            </Button>
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit">
              <Button onClick={() => viewContract && (setViewContract(null), openEdit(viewContract))}>
                Edit
              </Button>
            </Can>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation modal */}
      <AlertDialog open={!!deleteConfirmContract} onOpenChange={(open) => !open && setDeleteConfirmContract(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contract?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmContract
                ? `This will permanently delete "${deleteConfirmContract.title}". This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteContract.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmContract && deleteContract.mutate(deleteConfirmContract.id)}
              disabled={deleteContract.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteContract.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add / Edit form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Contract" : "Add Contract"}</DialogTitle>
            <DialogDescription>
              Enter contract details. Add attachment links for copies (e.g. PDF URLs).
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" aria-label="Contract form">
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="contract-supplier">Supplier</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(Number(v))}
                      value={field.value ? String(field.value) : ""}
                      disabled={!!editingId}
                    >
                      <FormControl>
                        <SelectTrigger id="contract-supplier" aria-label="Select supplier">
                          <SelectValue placeholder="Select supplier" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="contract-title">Title</FormLabel>
                    <FormControl>
                      <Input id="contract-title" aria-label="Contract title" placeholder="e.g. Master Service Agreement" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contractType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CONTRACT_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="referenceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference number</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="contract-start-date">Start date</FormLabel>
                      <FormControl>
                        <Input
                          id="contract-start-date"
                          type="date"
                          aria-label="Contract start date"
                          value={field.value ? format(new Date(field.value), "yyyy-MM-dd") : ""}
                          onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : undefined)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="contract-end-date">End date (optional)</FormLabel>
                      <FormControl>
                        <Input
                          id="contract-end-date"
                          type="date"
                          aria-label="Contract end date"
                          value={field.value ? format(new Date(field.value), "yyyy-MM-dd") : ""}
                          onChange={(e) =>
                            field.onChange(e.target.value ? new Date(e.target.value) : undefined)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="contract-value">Value (optional)</FormLabel>
                      <FormControl>
                        <Input
                          id="contract-value"
                          type="number"
                          step="0.01"
                          aria-label="Contract value"
                          placeholder="0"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={settings.currencyCode?.trim() || "USD"}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="summary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="contract-summary">Summary</FormLabel>
                    <FormControl>
                      <Textarea id="contract-summary" aria-label="Contract summary" placeholder="Brief summary of the contract" rows={3} {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="contract-notes">Notes</FormLabel>
                    <FormControl>
                      <Textarea id="contract-notes" aria-label="Contract notes" placeholder="Internal notes" rows={2} {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="attachments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Copies / attachment links</FormLabel>
                    <div className="space-y-2">
                      {(field.value ?? []).map((att, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <Input
                            placeholder="Label (e.g. Signed PDF)"
                            value={att.name}
                            onChange={(e) => {
                              const next = [...(field.value ?? [])];
                              next[i] = { ...next[i], name: e.target.value };
                              field.onChange(next);
                            }}
                            className="flex-1"
                          />
                          <Input
                            placeholder="URL"
                            value={att.url}
                            onChange={(e) => {
                              const next = [...(field.value ?? [])];
                              next[i] = { ...next[i], url: e.target.value };
                              field.onChange(next);
                            }}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              field.onChange((field.value ?? []).filter((_, j) => j !== i))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          field.onChange([...(field.value ?? []), { name: "", url: "" }])
                        }
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add link to copy
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createContract.isPending || updateContract.isPending}>
                  {editingId ? "Save changes" : "Create contract"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
