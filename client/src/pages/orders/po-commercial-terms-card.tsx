import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DepartmentOpt = { id: number; code: string; name: string };
type ContractOpt = {
  id: number;
  title: string;
  supplierId: number;
  currency?: string | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
  defaultTaxCodeId?: number | null;
};
type TermOpt = { id: number; code: string; name: string };
type IncotermOpt = { id: number; code: string; name: string };

type CurrencyOpt = { code: string; name: string };

type TaxCodeOpt = { id: number; code: string; name: string };

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
  taxCodeId: string;
  setTaxCodeId: (v: string) => void;
  taxCodes: TaxCodeOpt[];
  departments: DepartmentOpt[];
  contractsForSupplier: ContractOpt[];
  paymentTerms: TermOpt[];
  incoterms: IncotermOpt[];
  saveCommercialTerms: { mutate: () => void; isPending: boolean };
  /** When false, terms are read-only (PO sent or later). */
  canSaveCommercial: boolean;
  commercialLockedReason?: string;
  commercialSaveError?: string | null;
  onClearContract?: () => void;
  onUseContractCurrency?: () => void;
  /** Last “apply defaults” action — schema-level sourcing notes for currency and payment terms. */
  applyDefaultsHint?: string | null;
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
  taxCodeId,
  setTaxCodeId,
  taxCodes,
  departments,
  contractsForSupplier,
  paymentTerms,
  incoterms,
  saveCommercialTerms,
  canSaveCommercial,
  commercialLockedReason,
  commercialSaveError,
  onClearContract,
  onUseContractCurrency,
  applyDefaultsHint,
}: PoCommercialTermsCardProps) {
  const disableFields = !canSaveCommercial || saveCommercialTerms.isPending;
  const isContractCurrencyValidation =
    typeof commercialSaveError === "string" &&
    commercialSaveError.includes("SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED");
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
            {isContractCurrencyValidation ? (
              <div className="space-y-2">
                <p className="font-medium">Contract currency controls this purchase order.</p>
                <p>
                  The selected supplier contract has its own currency, so the PO currency must match it before the
                  commercial terms can be saved.
                </p>
                <div className="flex flex-wrap gap-2">
                  {onUseContractCurrency ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid="po-use-contract-currency"
                      onClick={onUseContractCurrency}
                      disabled={disableFields}
                    >
                      Use contract currency
                    </Button>
                  ) : null}
                  {onClearContract ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="po-clear-contract"
                      onClick={onClearContract}
                      disabled={disableFields}
                    >
                      Clear contract
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              commercialSaveError
            )}
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
            Fills order currency from the contract when it matches master data, otherwise from the supplier default.
            When the contract row has payment terms, incoterm, or default tax, those apply here. Payment terms and
            incoterms from the supplier are used as fallback where the contract leaves them blank. Currency options are
            the active Master Data list. Save to persist.
          </p>
        </div>
        {applyDefaultsHint ? (
          <div
            className="md:col-span-2 rounded-md border border-muted bg-muted/40 p-3 text-xs text-muted-foreground"
            data-testid="po-commercial-apply-hint"
          >
            {applyDefaultsHint}
          </div>
        ) : null}
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
        <div className="space-y-1">
          <Label htmlFor="po-tax-code">Default tax code (header)</Label>
          <Select value={taxCodeId} onValueChange={setTaxCodeId} disabled={disableFields}>
            <SelectTrigger id="po-tax-code">
              <SelectValue placeholder="Select tax code" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {taxCodes.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.code} — {t.name}
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
