import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Supplier } from "@shared/schema";

type CurrencyOpt = { code: string; name: string };
type ContractOpt = { id: number; title: string; supplierId: number };
type TermOpt = { id: number; code: string; name: string };

export function RequisitionCommercialHintCard({
  supplierId,
  suppliers,
  departmentLabel,
  currencies,
  contractsForSupplier,
  paymentTerms,
  incoterms,
  taxCodes,
}: {
  supplierId: number | "";
  suppliers: Supplier[];
  departmentLabel?: string;
  currencies: CurrencyOpt[];
  contractsForSupplier: ContractOpt[];
  paymentTerms: TermOpt[];
  incoterms: TermOpt[];
  taxCodes: Array<{ id: number; code: string; name: string }>;
}) {
  if (supplierId === "") return null;

  const supplier = suppliers.find((s) => s.id === supplierId);
  if (!supplier) return null;

  const code = String(supplier.defaultCurrencyCode ?? "").trim().toUpperCase();
  const currencyName = code && /^[A-Z]{3}$/.test(code) ? currencies.find((c) => c.code === code)?.name : undefined;
  const currencyDisplay =
    code && /^[A-Z]{3}$/.test(code) ? `${code}${currencyName ? ` — ${currencyName}` : ""}` : "USD (supplier default not set; PO will use USD)";

  return (
    <Card data-testid="requisition-commercial-hint">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">PO defaults after conversion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Requisitions do not store commercial terms. When this requisition is converted to a draft purchase order, the
          system copies your <span className="font-medium text-foreground">department</span>
          {departmentLabel ? ` (${departmentLabel})` : ""} and the{" "}
          <span className="font-medium text-foreground">supplier default currency</span> ({currencyDisplay}).
        </p>
        <p>
          Master data is available for the draft PO:{" "}
          <span className="text-foreground">{contractsForSupplier.length}</span> contract
          {contractsForSupplier.length === 1 ? "" : "s"},{" "}
          <span className="text-foreground">{paymentTerms.length}</span> payment term rows,{" "}
          <span className="text-foreground">{incoterms.length}</span> incoterms,{" "}
          <span className="text-foreground">{taxCodes.length}</span> tax codes.
        </p>
        {contractsForSupplier.length > 0 ? (
          <ul className="list-inside list-disc space-y-1 text-foreground">
            {contractsForSupplier.slice(0, 5).map((c) => (
              <li key={c.id}>{c.title}</li>
            ))}
            {contractsForSupplier.length > 5 ? (
              <li className="text-muted-foreground">…and {contractsForSupplier.length - 5} more</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-foreground/80">No contracts are linked to this supplier in master data.</p>
        )}
      </CardContent>
    </Card>
  );
}
