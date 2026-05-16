import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DepartmentOpt = { id: number; code: string; name: string };
type ContractOpt = { id: number; title: string; supplierId: number };
type TermOpt = { id: number; code: string; name: string };
type IncotermOpt = { id: number; code: string; name: string };

type CurrencyOpt = { code: string; name: string };

export type PoCommercialTermsCardProps = {
  departmentId: string;
  setDepartmentId: (v: string) => void;
  contractId: string;
  setContractId: (v: string) => void;
  currencyCode: string;
  setCurrencyCode: (v: string) => void;
  currencies: CurrencyOpt[];
  onApplyContractTerms?: () => void;
  paymentTermsId: string;
  setPaymentTermsId: (v: string) => void;
  incotermId: string;
  setIncotermId: (v: string) => void;
  departments: DepartmentOpt[];
  contractsForSupplier: ContractOpt[];
  paymentTerms: TermOpt[];
  incoterms: IncotermOpt[];
  saveCommercialTerms: { mutate: () => void; isPending: boolean };
  /** When false, terms are read-only (PO sent or later). */
  canSaveCommercial: boolean;
  commercialLockedReason?: string;
  commercialSaveError?: string | null;
};

export function PoCommercialTermsCard({
  departmentId,
  setDepartmentId,
  contractId,
  setContractId,
  currencyCode,
  setCurrencyCode,
  currencies,
  onApplyContractTerms,
  paymentTermsId,
  setPaymentTermsId,
  incotermId,
  setIncotermId,
  departments,
  contractsForSupplier,
  paymentTerms,
  incoterms,
  saveCommercialTerms,
  canSaveCommercial,
  commercialLockedReason,
  commercialSaveError,
}: PoCommercialTermsCardProps) {
  const disableFields = !canSaveCommercial || saveCommercialTerms.isPending;
  return (
    <Card id="po-commercial" className="scroll-mt-36" data-testid="po-commercial-card">
      <CardHeader>
        <CardTitle>Commercial terms</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {!canSaveCommercial && commercialLockedReason ? (
          <div
            className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="po-commercial-disabled-message"
          >
            {commercialLockedReason}
          </div>
        ) : null}
        {commercialSaveError ? (
          <div
            className="md:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="po-commercial-error"
          >
            {commercialSaveError}
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="po-department">Department</Label>
          <Select value={departmentId} onValueChange={setDepartmentId} disabled={disableFields}>
            <SelectTrigger id="po-department">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={String(department.id)}>
                  {department.code} - {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-contract">Contract reference</Label>
          <Select aria-label="Contract reference" value={contractId} onValueChange={setContractId} disabled={disableFields}>
            <SelectTrigger id="po-contract">
              <SelectValue placeholder="Select contract" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {contractsForSupplier.map((contract) => (
                <SelectItem key={contract.id} value={String(contract.id)}>
                  #{contract.id} - {contract.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-currency">Order currency</Label>
          <Select
            value={currencyCode}
            onValueChange={setCurrencyCode}
            disabled={disableFields}
          >
            <SelectTrigger id="po-currency" data-testid="po-currency-select">
              <SelectValue placeholder="Currency" />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 flex flex-wrap items-center gap-2">
          {typeof onApplyContractTerms === "function" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="po-apply-contract-terms"
              disabled={disableFields || contractId === "none"}
              onClick={onApplyContractTerms}
            >
              Apply contract & supplier defaults
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Uses contract currency (and supplier default currency / payment terms when available). Save terms to persist.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-payment-terms">Payment terms</Label>
          <Select value={paymentTermsId} onValueChange={setPaymentTermsId} disabled={disableFields}>
            <SelectTrigger id="po-payment-terms">
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
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-incoterm">Incoterm</Label>
          <Select value={incotermId} onValueChange={setIncotermId} disabled={disableFields}>
            <SelectTrigger id="po-incoterm">
              <SelectValue placeholder="Select incoterm" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {incoterms.map((incoterm) => (
                <SelectItem key={incoterm.id} value={String(incoterm.id)}>
                  {incoterm.code} - {incoterm.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button
            type="button"
            data-testid="po-commercial-save-button"
            onClick={() => saveCommercialTerms.mutate()}
            disabled={!canSaveCommercial || saveCommercialTerms.isPending}
          >
            Save terms
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
