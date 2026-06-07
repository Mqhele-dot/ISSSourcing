import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Can } from "@/components/auth/can";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { emptySupplierFormValues, type SupplierFormValues } from "@/pages/suppliers/supplier-form-types";

type PaymentTerm = { id: number; code: string; name: string };
type Currency = { id: number; code: string; name: string };
type Carrier = { id: number; code?: string | null; name: string; active?: boolean | null };
type TaxCode = { id: number; code: string; name: string; active?: boolean | null };
type Incoterm = { id: number; code: string; name: string };
type Department = { id: number; code: string; name: string };
type SupplierContractRef = { id: number; title: string; supplierId: number; status?: string | null };

const STEPS = ["profile", "commercial", "sites", "logistics", "risk", "audit"] as const;
type Step = (typeof STEPS)[number];

type SupplierFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSupplierId: number | null;
  setSelectedSupplierId: (id: number | null) => void;
  form: UseFormReturn<SupplierFormValues>;
  paymentTerms: PaymentTerm[];
  currencies: Currency[];
  carriers: Carrier[];
  taxCodes: TaxCode[];
  incoterms: Incoterm[];
  departments: Department[];
  contracts: SupplierContractRef[];
  onCreate: (data: SupplierFormValues) => void;
  onUpdate: (data: SupplierFormValues) => void;
  createPending: boolean;
  updatePending: boolean;
};

function textField(
  form: UseFormReturn<SupplierFormValues>,
  name: keyof SupplierFormValues,
  label: string,
  options: { type?: string; textarea?: boolean; placeholder?: string } = {},
) {
  return (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {options.textarea ? (
              <Textarea placeholder={options.placeholder} {...field} value={(field.value as string | null) || ""} />
            ) : (
              <Input type={options.type} placeholder={options.placeholder} {...field} value={(field.value as string | null) || ""} />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function booleanField(form: UseFormReturn<SupplierFormValues>, name: keyof SupplierFormValues, label: string, defaultChecked = false) {
  return (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="rounded-md border p-3">
          <FormLabel className="flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              checked={field.value == null ? defaultChecked : Boolean(field.value)}
              onChange={(event) => field.onChange(event.target.checked)}
            />
            {label}
          </FormLabel>
        </FormItem>
      )}
    />
  );
}

function numberSelect<T extends { id: number }>(props: {
  form: UseFormReturn<SupplierFormValues>;
  name: keyof SupplierFormValues;
  label: string;
  rows: T[];
  renderRow: (row: T) => string;
  placeholder: string;
}) {
  return (
    <FormField
      control={props.form.control}
      name={props.name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <Select
            value={field.value ? String(field.value) : "none"}
            onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}
          >
            <SelectTrigger>
              <SelectValue placeholder={props.placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {props.rows.map((row) => (
                <SelectItem key={row.id} value={String(row.id)}>
                  {props.renderRow(row)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
      )}
    />
  );
}

export function SupplierFormSheet({
  open,
  onOpenChange,
  selectedSupplierId,
  setSelectedSupplierId,
  form,
  paymentTerms,
  currencies,
  carriers,
  taxCodes,
  incoterms,
  departments,
  contracts,
  onCreate,
  onUpdate,
  createPending,
  updatePending,
}: SupplierFormSheetProps) {
  const [activeStep, setActiveStep] = useState<Step>("profile");
  const stepIndex = STEPS.indexOf(activeStep);
  const visibleContracts = contracts.filter((contract) => !selectedSupplierId || contract.supplierId === selectedSupplierId);

  useEffect(() => {
    if (!open) setActiveStep("profile");
  }, [open]);

  const closeSheet = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setActiveStep("profile");
      setSelectedSupplierId(null);
      form.reset(emptySupplierFormValues());
    }
  };

  return (
    <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add or edit suppliers">
      <Sheet open={open} onOpenChange={closeSheet}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg md:max-w-xl">
          <SheetHeader>
            <SheetTitle>{selectedSupplierId ? "Edit supplier" : "Add supplier"}</SheetTitle>
            <SheetDescription>
              Supplier details are shared by procurement, logistics, accounts payable, analytics, and exports.
            </SheetDescription>
          </SheetHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(selectedSupplierId ? onUpdate : onCreate)} className="mt-4 space-y-4">
              <Tabs value={activeStep} onValueChange={(value) => setActiveStep(value as Step)}>
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3">
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="commercial">Commercial</TabsTrigger>
                  <TabsTrigger value="sites">Contacts</TabsTrigger>
                  <TabsTrigger value="logistics">Logistics</TabsTrigger>
                  <TabsTrigger value="risk">Risk</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {textField(form, "supplierCode", "Supplier code")}
                    {textField(form, "legalName", "Legal name")}
                  </div>
                  {textField(form, "name", "Company name*", { placeholder: "Enter company name" })}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {textField(form, "contactName", "Primary contact")}
                    {textField(form, "phone", "Phone")}
                    {textField(form, "email", "Email")}
                    {textField(form, "taxIdentificationNumber", "Tax ID / VAT number")}
                  </div>
                  {textField(form, "address", "Address")}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select value={field.value || "active"} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                              <SelectItem value="blocked">Blocked</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="riskStatus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Risk summary</FormLabel>
                          <Select value={field.value || "unknown"} onValueChange={field.onChange}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="unknown">Unknown</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  {textField(form, "notes", "Notes", { textarea: true })}
                </TabsContent>

                <TabsContent value="commercial" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {textField(form, "bankName", "Bank name")}
                    {textField(form, "bankAccountNumber", "Bank account number")}
                    {textField(form, "bankSwift", "SWIFT/BIC")}
                    {numberSelect({ form, name: "paymentTermsId", label: "Payment terms", rows: paymentTerms, renderRow: (row) => `${row.code} - ${row.name}`, placeholder: "Select payment terms" })}
                    <FormField
                      control={form.control}
                      name="defaultCurrencyCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default currency</FormLabel>
                          <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? "" : value)}>
                            <SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {currencies.map((currency) => (
                                <SelectItem key={currency.id} value={currency.code}>{currency.code} - {currency.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    {numberSelect({ form, name: "taxCodeId", label: "Default tax code", rows: taxCodes.filter((row) => row.active !== false), renderRow: (row) => `${row.code} - ${row.name}`, placeholder: "Select tax code" })}
                    {numberSelect({ form, name: "incotermId", label: "Incoterm", rows: incoterms, renderRow: (row) => `${row.code} - ${row.name}`, placeholder: "Select incoterm" })}
                    {numberSelect({ form, name: "defaultDepartmentId", label: "Default department", rows: departments, renderRow: (row) => `${row.code} - ${row.name}`, placeholder: "Select department" })}
                    {numberSelect({ form, name: "defaultContractId", label: "Default contract", rows: visibleContracts, renderRow: (row) => row.title, placeholder: "Select contract" })}
                    {textField(form, "billControlPolicy", "Bill control policy")}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {booleanField(form, "allowCurrencyOverride", "Allow currency override")}
                    {booleanField(form, "requireApprovalForOverride", "Require override approval", true)}
                  </div>
                </TabsContent>

                <TabsContent value="sites" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {textField(form, "financeContactName", "Finance contact")}
                    {textField(form, "logisticsContactName", "Logistics contact")}
                    {textField(form, "pickupSite", "Pickup site")}
                    {textField(form, "deliverySite", "Delivery site")}
                    {textField(form, "billingAddress", "Billing address", { textarea: true })}
                    {textField(form, "remitToAddress", "Remit-to address", { textarea: true })}
                  </div>
                </TabsContent>

                <TabsContent value="logistics" className="space-y-4 pt-4">
                  <p className="rounded-md border p-3 text-sm text-muted-foreground">
                    Carriers live in supplier/master data so logistics can reuse the same preferred carrier instead of maintaining a separate carrier setup page.
                  </p>
                  {numberSelect({ form, name: "defaultCarrierId", label: "Preferred carrier", rows: carriers.filter((row) => row.active !== false), renderRow: (row) => row.code ? `${row.code} - ${row.name}` : row.name, placeholder: "Select carrier" })}
                  {textField(form, "defaultTransportMode", "Default transport mode", { placeholder: "road, air, sea, courier" })}
                </TabsContent>

                <TabsContent value="risk" className="space-y-4 pt-4">
                  <FormField
                    control={form.control}
                    name="complianceStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Compliance status</FormLabel>
                        <Select value={field.value || "unknown"} onValueChange={field.onChange}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="compliant">Compliant</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="expired">Expired</SelectItem>
                            <SelectItem value="blocked">Blocked</SelectItem>
                            <SelectItem value="unknown">Unknown</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  {textField(form, "insuranceExpiry", "Insurance expiry", { type: "date" })}
                  {textField(form, "blockedReason", "Blocked supplier reason", { textarea: true })}
                  {textField(form, "complianceNotes", "Compliance notes", { textarea: true })}
                </TabsContent>

                <TabsContent value="audit" className="space-y-4 pt-4">
                  {selectedSupplierId ? (
                    <EntityDocumentsCard entityType="supplier" entityId={selectedSupplierId} title="Supplier documents" />
                  ) : (
                    <p className="rounded-md border p-3 text-sm text-muted-foreground">
                      Save the supplier first to attach documents and build the audit record.
                    </p>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <Button type="button" variant="outline" size="sm" onClick={() => setActiveStep(STEPS[Math.max(0, stepIndex - 1)])} disabled={stepIndex === 0}>
                  Previous section
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setActiveStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)])} disabled={stepIndex >= STEPS.length - 1}>
                  Next section
                </Button>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => closeSheet(false)}>Close</Button>
                <Button type="submit" disabled={createPending || updatePending}>
                  {createPending || updatePending ? "Saving..." : selectedSupplierId ? "Update supplier" : "Add supplier"}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </Can>
  );
}
