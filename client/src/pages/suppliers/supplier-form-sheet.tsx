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
type Carrier = { id: number; code?: string | null; name: string; active?: boolean | null };
type TaxCode = { id: number; code: string; name: string; active?: boolean | null };
type Incoterm = { id: number; code: string; name: string };
type Department = { id: number; code: string; name: string };
type SupplierContractRef = { id: number; title: string; supplierId: number; status?: string | null };

const SUPPLIER_FORM_STEPS = [
  "overview",
  "profile",
  "commercial",
  "sites",
  "contracts",
  "history",
  "logistics",
  "ap",
  "risk",
  "audit",
] as const;
type SupplierFormStep = (typeof SUPPLIER_FORM_STEPS)[number];

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
  const [activeStep, setActiveStep] = useState<SupplierFormStep>("overview");

  useEffect(() => {
    if (!open) setActiveStep("overview");
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
            setActiveStep("overview");
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
                <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5 gap-1">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="commercial">Commercial</TabsTrigger>
                  <TabsTrigger value="sites">Contacts & Sites</TabsTrigger>
                  <TabsTrigger value="contracts">Contracts</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="logistics">Logistics</TabsTrigger>
                  <TabsTrigger value="ap">AP</TabsTrigger>
                  <TabsTrigger value="risk">Risk</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 pt-4">
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    Supplier master data entered here flows into procurement, AP, logistics, reports, analytics, exports, and diagnostics.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supplier status</FormLabel>
                          <Select value={field.value || "active"} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="inactive">Inactive</SelectItem>
                              <SelectItem value="blocked">Blocked</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
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
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
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
                </TabsContent>

                <TabsContent value="profile" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="supplierCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supplier code</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="legalName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Legal name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
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

                <TabsContent value="commercial" className="space-y-4 pt-4">
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
                  <FormField
                    control={form.control}
                    name="defaultCarrierId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="supplier-default-carrier">Preferred carrier</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value ? String(field.value) : "none"}
                            onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}
                          >
                            <SelectTrigger id="supplier-default-carrier" aria-label="Supplier preferred carrier">
                              <SelectValue placeholder="Select preferred carrier" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {carriers
                                .filter((carrier) => carrier.active !== false)
                                .map((carrier) => (
                                  <SelectItem key={carrier.id} value={String(carrier.id)}>
                                    {carrier.code ? `${carrier.code} - ${carrier.name}` : carrier.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="taxCodeId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default tax code</FormLabel>
                          <Select value={field.value ? String(field.value) : "none"} onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}>
                            <SelectTrigger><SelectValue placeholder="Select tax code" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {taxCodes.filter((code) => code.active !== false).map((code) => (
                                <SelectItem key={code.id} value={String(code.id)}>{code.code} - {code.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="incotermId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Incoterm</FormLabel>
                          <Select value={field.value ? String(field.value) : "none"} onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}>
                            <SelectTrigger><SelectValue placeholder="Select incoterm" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {incoterms.map((incoterm) => (
                                <SelectItem key={incoterm.id} value={String(incoterm.id)}>{incoterm.code} - {incoterm.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="defaultDepartmentId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default department</FormLabel>
                          <Select value={field.value ? String(field.value) : "none"} onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}>
                            <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {departments.map((department) => (
                                <SelectItem key={department.id} value={String(department.id)}>{department.code} - {department.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="defaultContractId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default contract</FormLabel>
                          <Select value={field.value ? String(field.value) : "none"} onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}>
                            <SelectTrigger><SelectValue placeholder="Select contract" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {contracts.filter((contract) => !selectedSupplierId || contract.supplierId === selectedSupplierId).map((contract) => (
                                <SelectItem key={contract.id} value={String(contract.id)}>{contract.title}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="billControlPolicy"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bill control policy</FormLabel>
                          <FormControl><Input placeholder="standard, strict, exception" {...field} value={field.value || ""} /></FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="allowCurrencyOverride"
                      render={({ field }) => (
                        <FormItem className="rounded-md border p-3">
                          <FormLabel className="flex items-center gap-2">
                            <input type="checkbox" checked={Boolean(field.value)} onChange={(event) => field.onChange(event.target.checked)} />
                            Allow currency override
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="requireApprovalForOverride"
                      render={({ field }) => (
                        <FormItem className="rounded-md border p-3">
                          <FormLabel className="flex items-center gap-2">
                            <input type="checkbox" checked={field.value !== false} onChange={(event) => field.onChange(event.target.checked)} />
                            Require override confirmation
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="sites" className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="financeContactName" render={({ field }) => (
                      <FormItem><FormLabel>Finance contact</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="logisticsContactName" render={({ field }) => (
                      <FormItem><FormLabel>Logistics contact</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="billingAddress" render={({ field }) => (
                      <FormItem><FormLabel>Billing address</FormLabel><FormControl><Textarea {...field} value={field.value || ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="remitToAddress" render={({ field }) => (
                      <FormItem><FormLabel>Remit-to address</FormLabel><FormControl><Textarea {...field} value={field.value || ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="pickupSite" render={({ field }) => (
                      <FormItem><FormLabel>Pickup site</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="deliverySite" render={({ field }) => (
                      <FormItem><FormLabel>Delivery site</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl></FormItem>
                    )} />
                  </div>
                </TabsContent>

                <TabsContent value="contracts" className="space-y-4 pt-4">
                  <p className="text-sm text-muted-foreground">Default contract terms can override supplier defaults only where explicitly selected.</p>
                  <FormField
                    control={form.control}
                    name="defaultContractId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default contract</FormLabel>
                        <Select value={field.value ? String(field.value) : "none"} onValueChange={(value) => field.onChange(value === "none" ? null : Number(value))}>
                          <SelectTrigger><SelectValue placeholder="Select contract" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {contracts.filter((contract) => !selectedSupplierId || contract.supplierId === selectedSupplierId).map((contract) => (
                              <SelectItem key={contract.id} value={String(contract.id)}>{contract.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="history" className="space-y-4 pt-4">
                  <p className="text-sm text-muted-foreground">Requisitions, POs, received quantities, cancellations, and performance analytics use this supplier record as their master-data source.</p>
                </TabsContent>

                <TabsContent value="logistics" className="space-y-4 pt-4">
                  <p className="text-sm text-muted-foreground">Preferred carrier and transport mode are applied to inbound delivery workflows where the supplier is known.</p>
                  <FormField control={form.control} name="defaultTransportMode" render={({ field }) => (
                    <FormItem><FormLabel>Default transport mode</FormLabel><FormControl><Input placeholder="road, air, sea, courier" {...field} value={field.value || ""} /></FormControl></FormItem>
                  )} />
                </TabsContent>

                <TabsContent value="ap" className="space-y-4 pt-4">
                  <p className="text-sm text-muted-foreground">Invoices default from the PO first, then from this supplier when no PO is linked.</p>
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">Bank/remit fields are saved in Commercial Defaults and Contacts & Sites.</div>
                </TabsContent>

                <TabsContent value="risk" className="space-y-4 pt-4">
                  <FormField control={form.control} name="complianceStatus" render={({ field }) => (
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
                  )} />
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
                  <FormField control={form.control} name="blockedReason" render={({ field }) => (
                    <FormItem><FormLabel>Blocked supplier reason</FormLabel><FormControl><Textarea {...field} value={field.value || ""} /></FormControl></FormItem>
                  )} />
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

                <TabsContent value="audit" className="space-y-4 pt-4">
                  <p className="text-sm text-muted-foreground">Supplier changes and downstream document effects are visible through activity logs, PO revisions, and diagnostics.</p>
                  {selectedSupplierId ? (
                    <EntityDocumentsCard entityType="supplier" entityId={selectedSupplierId} title="Supplier documents" />
                  ) : (
                    <p className="text-sm text-muted-foreground">Save the supplier first to attach documents and build the audit record.</p>
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
