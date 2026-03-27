import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Can } from "@/components/auth/can";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";
import type { SupplierFormValues } from "@/pages/suppliers/supplier-form-types";
import { emptySupplierFormValues } from "@/pages/suppliers/supplier-form-types";

type PaymentTerm = { id: number; code: string; name: string };
type Currency = { id: number; code: string; name: string };

const SUPPLIER_FORM_STEPS = ["general", "banking", "compliance", "documents"] as const;
type SupplierFormStep = (typeof SUPPLIER_FORM_STEPS)[number];

type SupplierFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSupplierId: number | null;
  setSelectedSupplierId: (id: number | null) => void;
  form: UseFormReturn<SupplierFormValues>;
  paymentTerms: PaymentTerm[];
  currencies: Currency[];
  onCreate: (data: SupplierFormValues) => void;
  onUpdate: (data: SupplierFormValues) => void;
  createPending: boolean;
  updatePending: boolean;
};

export function SupplierFormSheet({
  open,
  onOpenChange,
  selectedSupplierId,
  setSelectedSupplierId,
  form,
  paymentTerms,
  currencies,
  onCreate,
  onUpdate,
  createPending,
  updatePending,
}: SupplierFormSheetProps) {
  const [activeStep, setActiveStep] = useState<SupplierFormStep>("general");

  useEffect(() => {
    if (!open) setActiveStep("general");
  }, [open]);

  const stepIndex = SUPPLIER_FORM_STEPS.indexOf(activeStep);
  const goPrev = () => {
    if (stepIndex > 0) setActiveStep(SUPPLIER_FORM_STEPS[stepIndex - 1]);
  };
  const goNext = () => {
    if (stepIndex < SUPPLIER_FORM_STEPS.length - 1) setActiveStep(SUPPLIER_FORM_STEPS[stepIndex + 1]);
  };

  return (
    <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to add or edit suppliers">
      <Sheet
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) {
            setActiveStep("general");
            setSelectedSupplierId(null);
            form.reset(emptySupplierFormValues());
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-lg md:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedSupplierId ? "Edit supplier" : "Add supplier"}</SheetTitle>
            <SheetDescription>
              Step through sections with Next / Previous, or jump using tabs ({stepIndex + 1}/{SUPPLIER_FORM_STEPS.length}).
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(selectedSupplierId ? onUpdate : onCreate)}
              className="space-y-4 mt-4"
              aria-label="Supplier form"
            >
              <Tabs value={activeStep} onValueChange={(v) => setActiveStep(v as SupplierFormStep)} className="w-full">
                <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4 gap-1">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="banking">Banking</TabsTrigger>
                  <TabsTrigger value="compliance">Compliance</TabsTrigger>
                  <TabsTrigger value="documents">Docs</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 pt-4">
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
                          <Input
                            id="supplier-contact"
                            aria-label="Contact person"
                            placeholder="Enter contact name"
                            {...field}
                            value={field.value || ""}
                          />
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
                            <Input
                              id="supplier-email"
                              aria-label="Email"
                              placeholder="email@example.com"
                              {...field}
                              value={field.value || ""}
                            />
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
                            <Input
                              id="supplier-phone"
                              aria-label="Phone"
                              placeholder="(555) 123-4567"
                              {...field}
                              value={field.value || ""}
                            />
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
                          <Input id="supplier-address" aria-label="Address" placeholder="123 Main St" {...field} value={field.value || ""} />
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
                          <Input
                            id="supplier-taxid"
                            aria-label="Tax ID or VAT number"
                            placeholder="Tax registration"
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
                            placeholder="Additional information"
                            className="min-h-[100px]"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="banking" className="space-y-4 pt-4">
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
                            <Input
                              id="supplier-bank-account"
                              aria-label="Bank account number"
                              placeholder="Account number"
                              {...field}
                              value={field.value || ""}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="bankSwift"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-bank-swift">SWIFT/BIC</FormLabel>
                        <FormControl>
                          <Input id="supplier-bank-swift" aria-label="SWIFT/BIC" placeholder="SWIFT/BIC code" {...field} value={field.value || ""} />
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
                  <FormField
                    control={form.control}
                    name="defaultCurrencyCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-default-currency">Default currency</FormLabel>
                        <FormControl>
                          <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? "" : value)}>
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
                </TabsContent>

                <TabsContent value="compliance" className="space-y-4 pt-4">
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
                </TabsContent>

                <TabsContent value="documents" className="space-y-4 pt-4">
                  {selectedSupplierId ? (
                    <EntityDocumentsCard entityType="supplier" entityId={selectedSupplierId} title="Compliance documents" />
                  ) : (
                    <p className="text-sm text-muted-foreground">Save the supplier first, then attach compliance documents here.</p>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t">
                <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={stepIndex === 0}>
                  Previous section
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={goNext}
                  disabled={stepIndex >= SUPPLIER_FORM_STEPS.length - 1}
                >
                  Next section
                </Button>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button type="submit" disabled={createPending || updatePending}>
                  {createPending || updatePending ? (
                    <span>Saving...</span>
                  ) : selectedSupplierId ? (
                    <span>Update supplier</span>
                  ) : (
                    <span>Add supplier</span>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </Can>
  );
}
