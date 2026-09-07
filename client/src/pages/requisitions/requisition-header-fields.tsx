import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableRecordCombobox } from "@/components/searchable-record-combobox";
import type { Supplier } from "@shared/schema";
import type { RequisitionFieldErrors } from "@/pages/requisitions/use-requisition-form";

type Dept = { id: number; code: string; name: string };
type CurrencyOption = {
  code: string;
  name: string;
  symbol?: string | null;
  regionCode?: string | null;
  regionName?: string | null;
  isMainForRegion?: boolean | null;
  exchangeRateToZar?: number | null;
};

export function RequisitionHeaderFields({
  suppliers,
  departments,
  projects = [],
  supplierId,
  currencyCode,
  currencies,
  exchangeRateToZar,
  reportingCurrencyCode,
  requisitionTotals,
  departmentId,
  projectId,
  requiredDate,
  justification,
  notes,
  fieldErrors,
  requiresDepartment = true,
  readOnly = false,
  onSupplierChange,
  onCurrencyChange,
  onCreateSupplier,
  onDepartmentChange,
  onProjectChange,
  onRequiredDateChange,
  onJustificationChange,
  onNotesChange,
}: {
  suppliers: Supplier[];
  departments: Dept[];
  currencies: CurrencyOption[];
  /** From `/api/extensions/projects` when extensions are enabled */
  projects?: { id: number; code: string; name: string }[];
  supplierId: number | "";
  currencyCode: string;
  exchangeRateToZar: number;
  reportingCurrencyCode: string;
  requisitionTotals: { orderTotal: number; reportingTotal: number; zarTotal: number };
  departmentId: number | "";
  projectId: number | "";
  requiredDate: string;
  justification: string;
  notes: string;
  fieldErrors: RequisitionFieldErrors;
  requiresDepartment?: boolean;
  readOnly?: boolean;
  onSupplierChange: (v: number | "") => void;
  onCurrencyChange: (v: string) => void;
  onCreateSupplier: (payload: { name: string; email?: string; phone?: string }) => void;
  onDepartmentChange: (v: number | "") => void;
  onProjectChange: (v: number | "") => void;
  onRequiredDateChange: (v: string) => void;
  onJustificationChange: (v: string) => void;
  onNotesChange: (v: string) => void;
}) {
  const [showSupplierCreate, setShowSupplierCreate] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const selectedCurrency = currencies.find((currency) => currency.code === currencyCode);

  return (
    <>
      <div className="rounded-md border bg-muted/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Commercial setup</h2>
            <p className="text-sm text-muted-foreground">
              Supplier, region currency, and exchange rate come from Master Data and flow into approvals and purchase orders.
            </p>
          </div>
          {selectedCurrency ? (
            <Badge variant="secondary">
              {selectedCurrency.regionCode ?? "Global"} / {selectedCurrency.code} @ {Number(exchangeRateToZar || 0).toFixed(4)} {reportingCurrencyCode}
            </Badge>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="req-supplier">Supplier *</Label>
          <SearchableRecordCombobox
            id="req-supplier"
            value={supplierId === "" ? "" : String(supplierId)}
            onValueChange={(value) => onSupplierChange(Number(value))}
            options={suppliers.map((supplier) => ({
              value: String(supplier.id),
              label: `${supplier.name}${(supplier as Supplier & { defaultCurrencyCode?: string | null }).defaultCurrencyCode ? ` | ${(supplier as Supplier & { defaultCurrencyCode?: string | null }).defaultCurrencyCode}` : ""}`,
              keywords: `${(supplier as Supplier & { supplierCode?: string | null }).supplierCode ?? ""} ${supplier.email ?? ""} ${supplier.phone ?? ""}`,
            }))}
            placeholder="Select supplier..."
            searchPlaceholder="Search supplier, code, email, or currency..."
            ariaLabel="Select supplier"
            disabled={readOnly}
          />
          {!readOnly ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{suppliers.length} approved supplier(s) available. Search shows 20 at a time.</p>
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setShowSupplierCreate((open) => !open)}>
                {showSupplierCreate ? "Hide new supplier" : "Add supplier here"}
              </Button>
            </div>
          ) : null}
          {fieldErrors.supplierId ? <p className="text-xs text-destructive">{fieldErrors.supplierId}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-currency">Request currency *</Label>
          <SearchableRecordCombobox
            id="req-currency"
            value={currencyCode}
            onValueChange={onCurrencyChange}
            options={currencies.map((currency) => ({
              value: currency.code,
              label: `${currency.code} - ${currency.name}${currency.isMainForRegion ? " | main" : ""} | ${currency.regionCode ?? "Global"}`,
              keywords: `${currency.regionName ?? ""} ${currency.symbol ?? ""}`,
            }))}
            placeholder="Select currency..."
            searchPlaceholder="Search currency, region, or code..."
            ariaLabel="Select requisition currency"
            disabled={readOnly}
          />
          <p className="text-xs text-muted-foreground">
             {currencyCode === reportingCurrencyCode
               ? `${reportingCurrencyCode} is this organization's reporting currency.`
               : `1 ${currencyCode} = ${Number(exchangeRateToZar || 0).toFixed(4)} ${reportingCurrencyCode} from Master Data.`}
          </p>
          {fieldErrors.currencyCode ? <p className="text-xs text-destructive">{fieldErrors.currencyCode}</p> : null}
        </div>
        {showSupplierCreate ? (
          <div className="rounded-md border bg-background p-3 sm:col-span-2">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="req-new-supplier-name">New supplier name</Label>
                <Input id="req-new-supplier-name" value={newSupplierName} onChange={(event) => setNewSupplierName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="req-new-supplier-email">Email</Label>
                <Input id="req-new-supplier-email" value={newSupplierEmail} onChange={(event) => setNewSupplierEmail(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="req-new-supplier-phone">Phone</Label>
                <Input id="req-new-supplier-phone" value={newSupplierPhone} onChange={(event) => setNewSupplierPhone(event.target.value)} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">This creates a prospective supplier for governed onboarding with {currencyCode} as its proposed currency.</p>
              <Button
                type="button"
                size="sm"
                disabled={!newSupplierName.trim()}
                onClick={() => {
                  onCreateSupplier({ name: newSupplierName.trim(), email: newSupplierEmail.trim(), phone: newSupplierPhone.trim() });
                  setNewSupplierName("");
                  setNewSupplierEmail("");
                  setNewSupplierPhone("");
                  setShowSupplierCreate(false);
                }}
              >
                Add supplier
              </Button>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="req-department">Department{requiresDepartment ? " *" : ""}</Label>
          <SearchableRecordCombobox
            id="req-department"
            value={departmentId === "" ? "" : String(departmentId)}
            onValueChange={(value) => onDepartmentChange(Number(value))}
            options={departments.map((department) => ({ value: String(department.id), label: `${department.code} - ${department.name}` }))}
            placeholder="Select department..."
            searchPlaceholder="Search department code or name..."
            ariaLabel="Select department"
            disabled={readOnly}
          />
          {fieldErrors.departmentId ? <p className="text-xs text-destructive">{fieldErrors.departmentId}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-required-date">Required date *</Label>
          <Input
            id="req-required-date"
            aria-label="Required date"
            type="date"
            value={requiredDate}
            onChange={(e) => onRequiredDateChange(e.target.value)}
            disabled={readOnly}
          />
          {fieldErrors.requiredDate ? <p className="text-xs text-destructive">{fieldErrors.requiredDate}</p> : null}
        </div>
        <div className="rounded-md border bg-background p-3 sm:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Requested total</p>
              <p className="text-lg font-semibold tabular-nums">{currencyCode} {requisitionTotals.orderTotal.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Converted reporting value</p>
              <p className="text-lg font-semibold tabular-nums">{reportingCurrencyCode} {requisitionTotals.reportingTotal.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Exchange source</p>
              <p className="text-sm">{selectedCurrency?.regionName ?? "Master Data"} currency setup</p>
            </div>
          </div>
        </div>
        {projects.length > 0 ? (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="req-project">Project (optional)</Label>
            <SearchableRecordCombobox
              id="req-project"
              value={projectId === "" ? "__none__" : String(projectId)}
              onValueChange={(value) => onProjectChange(value === "__none__" ? "" : Number(value))}
              options={[
                { value: "__none__", label: "No project" },
                ...projects.map((project) => ({ value: String(project.id), label: `${project.code} - ${project.name}` })),
              ]}
              placeholder="No project"
              searchPlaceholder="Search project code or name..."
              ariaLabel="Project"
              disabled={readOnly}
            />
            {fieldErrors.projectId ? <p className="text-xs text-destructive">{fieldErrors.projectId}</p> : null}
          </div>
        ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-justification">Justification</Label>
        <Textarea
          id="req-justification"
          aria-label="Requisition justification"
          value={justification}
          onChange={(e) => onJustificationChange(e.target.value)}
          rows={2}
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-notes">Notes</Label>
        <Textarea id="req-notes" aria-label="Requisition notes" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={3} disabled={readOnly} />
      </div>
    </>
  );
}
