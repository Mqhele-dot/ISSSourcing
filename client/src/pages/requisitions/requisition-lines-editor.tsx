import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SearchableRecordCombobox } from "@/components/searchable-record-combobox";
import type { InventoryItem } from "@shared/schema";

export interface ReqLineDraft {
  id?: number;
  itemId: number | null;
  lineType: "CATALOG" | "NON_STOCK" | "SERVICE";
  description?: string;
  manualEntryReason?: string;
  receiptRequired?: boolean;
  quantity: number;
  unitPrice: number;
  unitOfMeasureId?: number | null;
  taxCodeId?: number | null;
  costCentreId?: number | null;
  glAccountCode?: string | null;
  supplierItemCode?: string | null;
  baseUomId?: number | null;
  conversionFactor?: number | null;
  lineCurrencyCode?: string | null;
  notes?: string;
}

type RequisitionLinesEditorProps = {
  items: ReqLineDraft[];
  inventoryItems: Array<
    InventoryItem & { supplierPartNumber?: string | null; taxable?: boolean | null; glAccountCode?: string | null }
  >;
  unitsOfMeasure: Array<{ id: number; code: string; name: string; symbol?: string | null; active?: boolean | null }>;
  taxCodes: Array<{ id: number; code: string; name: string; active?: boolean | null }>;
  costCentres?: Array<{ id: number; code: string; name: string; active?: boolean | null }>;
  currencyCode: string;
  exchangeRateToZar: number;
  reportingCurrencyCode: string;
  fieldError?: string;
  rules?: { requiresCostCentre?: boolean; requiresTaxCode?: boolean };
  onAddRow: () => void;
  onRemoveRow: (idx: number) => void;
  onUpdateRow: (idx: number, field: keyof ReqLineDraft, value: number | string | boolean | null) => void;
  readOnly?: boolean;
  lockedReason?: string;
};

export function RequisitionLinesEditor({
  items,
  inventoryItems,
  unitsOfMeasure,
  taxCodes,
  costCentres = [],
  currencyCode,
  exchangeRateToZar,
  reportingCurrencyCode,
  fieldError,
  rules,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  readOnly = false,
  lockedReason,
}: RequisitionLinesEditorProps) {
  return (
    <div className="space-y-4" data-testid="requisition-lines-editor">
      <div className="flex items-center justify-between">
        <Label id="req-items-label">Items</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddRow}
          aria-label="Add item row"
          data-testid="requisition-add-line-button"
          disabled={readOnly}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add item
        </Button>
      </div>
      {readOnly ? (
        <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground" data-testid="requisition-lines-readonly-message">
          {lockedReason || "Requisition lines are read-only for this status."}
        </p>
      ) : null}
      <div className="space-y-4" role="group" aria-labelledby="req-items-label">
        {items.map((item, idx) => {
          const lineKey = item.id ?? idx;
          const selectedItem = inventoryItems.find((candidate) => Number(candidate.id) === Number(item.itemId));
          const isManual = item.lineType !== "CATALOG";
          const selectedUom = unitsOfMeasure.find((uom) => Number(uom.id) === Number(item.unitOfMeasureId));
          const selectedTaxCode = taxCodes.find((taxCode) => Number(taxCode.id) === Number(item.taxCodeId));
          const lineValue = Number(item.quantity || 0) * Number(item.unitPrice || 0);
          const warnings = [
            selectedItem && !item.unitOfMeasureId ? "Selected item has no UOM." : null,
            selectedItem && selectedItem.taxable !== false && !item.taxCodeId ? "Selected item has no tax code." : null,
            selectedItem && !item.glAccountCode ? "Selected item has no GL mapping." : null,
            currencyCode !== reportingCurrencyCode && (!Number.isFinite(exchangeRateToZar) || exchangeRateToZar <= 0)
              ? "Selected currency has no active FX rate."
              : null,
          ].filter(Boolean);
          return (
          <div
            key={lineKey}
            className="grid min-w-0 gap-4 rounded-md border p-4 lg:grid-cols-2 xl:grid-cols-[minmax(260px,1.7fr)_minmax(84px,.55fr)_minmax(130px,.85fr)_minmax(130px,.85fr)_minmax(130px,.85fr)_minmax(180px,1fr)_40px]"
            data-testid={`requisition-line-row-${lineKey}`}
          >
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1" aria-label={`Line ${idx + 1} type`}>
                {(["CATALOG", "NON_STOCK", "SERVICE"] as const).map((type) => (
                  <Button
                    key={type}
                    type="button"
                    size="sm"
                    variant={item.lineType === type ? "default" : "ghost"}
                    onClick={() => onUpdateRow(idx, "lineType", type)}
                    disabled={readOnly}
                    data-testid={`requisition-line-type-${lineKey}-${type.toLowerCase()}`}
                  >
                    {type === "CATALOG" ? "Catalog" : type === "NON_STOCK" ? "Non-stock" : "Service"}
                  </Button>
                ))}
              </div>
              <Label htmlFor={"req-item-" + idx}>{isManual ? "Description *" : "Item *"}</Label>
              {isManual ? (
                <Textarea id={"req-item-" + idx} value={item.description ?? ""} onChange={(event) => onUpdateRow(idx, "description", event.target.value)} placeholder={item.lineType === "SERVICE" ? "Describe the service and deliverable" : "Describe the non-stock good"} disabled={readOnly} data-testid={`requisition-line-description-${lineKey}`} />
              ) : (
              <SearchableRecordCombobox
                value={item.itemId ? String(item.itemId) : ""}
                onValueChange={(value) => onUpdateRow(idx, "itemId", Number(value))}
                options={inventoryItems.map((inventoryItem) => ({
                  value: String(inventoryItem.id),
                  label: `${inventoryItem.name} (${inventoryItem.sku})`,
                  keywords: `${inventoryItem.sku} ${inventoryItem.supplierPartNumber ?? ""}`,
                }))}
                placeholder="Select item..."
                searchPlaceholder="Search item name, SKU, or supplier part..."
                disabled={readOnly}
                id={"req-item-" + idx}
                ariaLabel={"Select item for line " + (idx + 1)}
                testId={`requisition-line-item-${lineKey}`}
              />
              )}
              {isManual ? (
                <>
                  <Input value={item.manualEntryReason ?? ""} onChange={(event) => onUpdateRow(idx, "manualEntryReason", event.target.value)} placeholder="Business reason for manual entry *" disabled={readOnly} data-testid={`requisition-line-reason-${lineKey}`} />
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`req-evidence-${lineKey}`}
                      checked={item.receiptRequired !== false}
                      onCheckedChange={(checked) => onUpdateRow(idx, "receiptRequired", checked)}
                      disabled={readOnly}
                      data-testid={`requisition-line-evidence-${lineKey}`}
                    />
                    <Label htmlFor={`req-evidence-${lineKey}`} className="text-xs font-normal">{item.lineType === "SERVICE" ? "Service confirmation required" : "Goods receipt required"}</Label>
                  </div>
                </>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={"req-qty-" + idx}>Qty *</Label>
              <Input
                id={"req-qty-" + idx}
                aria-label={"Quantity for line " + (idx + 1)}
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => onUpdateRow(idx, "quantity", Number(e.target.value))}
                disabled={readOnly}
                data-testid={`requisition-line-qty-${lineKey}`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={"req-uom-" + idx}>Purchase UOM *</Label>
              <SearchableRecordCombobox
                value={item.unitOfMeasureId ? String(item.unitOfMeasureId) : ""}
                onValueChange={(value) => onUpdateRow(idx, "unitOfMeasureId", Number(value))}
                options={unitsOfMeasure.filter((uom) => uom.active !== false).map((uom) => ({
                  value: String(uom.id),
                  label: `${uom.code || uom.symbol || uom.name} - ${uom.name}`,
                  keywords: `${uom.symbol ?? ""}`,
                }))}
                placeholder="Select UOM"
                searchPlaceholder="Search unit code or name..."
                disabled={readOnly}
                id={"req-uom-" + idx}
                ariaLabel={"Select purchase UOM for line " + (idx + 1)}
                testId={`requisition-line-uom-${lineKey}`}
              />
              {selectedUom ? <p className="text-xs text-muted-foreground">{selectedUom.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={"req-unitprice-" + idx}>Unit price ({currencyCode}) *</Label>
              <Input
                id={"req-unitprice-" + idx}
                aria-label={"Unit price for line " + (idx + 1)}
                type="number"
                min={0}
                step={0.01}
                value={item.unitPrice}
                onChange={(e) => onUpdateRow(idx, "unitPrice", Number(e.target.value))}
                disabled={readOnly}
                data-testid={`requisition-line-unit-price-${lineKey}`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={"req-tax-" + idx}>Tax code{rules?.requiresTaxCode ? " *" : ""}</Label>
              <SearchableRecordCombobox
                value={item.taxCodeId ? String(item.taxCodeId) : ""}
                onValueChange={(value) => onUpdateRow(idx, "taxCodeId", Number(value))}
                options={taxCodes.filter((taxCode) => taxCode.active !== false).map((taxCode) => ({
                  value: String(taxCode.id),
                  label: `${taxCode.code} - ${taxCode.name}`,
                }))}
                placeholder="Select tax"
                searchPlaceholder="Search tax code or name..."
                disabled={readOnly}
                id={"req-tax-" + idx}
                ariaLabel={"Select tax code for line " + (idx + 1)}
                testId={`requisition-line-tax-${lineKey}`}
              />
              {selectedTaxCode ? <p className="text-xs text-muted-foreground">{selectedTaxCode.name}</p> : null}
            </div>
            <div className="space-y-2">
              <Label>Line value</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm tabular-nums">
                <div>{currencyCode} {lineValue.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">
                  {reportingCurrencyCode} {(lineValue * Number(exchangeRateToZar || 0)).toFixed(2)}
                </div>
              </div>
              {costCentres.length > 0 ? (
                <SearchableRecordCombobox
                  value={item.costCentreId ? String(item.costCentreId) : ""}
                  onValueChange={(value) => onUpdateRow(idx, "costCentreId", value === "__none__" ? null : Number(value))}
                  options={[
                    ...(rules?.requiresCostCentre ? [] : [{ value: "__none__", label: "No cost centre" }]),
                    ...costCentres.filter((costCentre) => costCentre.active !== false).map((costCentre) => ({
                      value: String(costCentre.id),
                      label: `${costCentre.code} - ${costCentre.name}`,
                    })),
                  ]}
                  placeholder={rules?.requiresCostCentre ? "Cost centre *" : "Cost centre"}
                  searchPlaceholder="Search cost centre..."
                  disabled={readOnly}
                  ariaLabel={"Select cost centre for line " + (idx + 1)}
                  testId={`requisition-line-cost-centre-${lineKey}`}
                />
              ) : null}
              <p className={item.glAccountCode ? "text-xs text-muted-foreground" : "text-xs text-amber-700"}>
                {item.glAccountCode ? `GL ${item.glAccountCode}` : "GL mapping missing"}
              </p>
            </div>
            {!readOnly ? (
              <Button
                variant="ghost"
                size="icon"
                className="justify-self-end self-start lg:col-span-2 xl:col-span-1"
                onClick={() => onRemoveRow(idx)}
                aria-label={"Remove item line " + (idx + 1)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            ) : null}
            {warnings.length > 0 ? (
              <div className="lg:col-span-2 xl:col-span-7 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {warnings.join(" ")}
              </div>
            ) : null}
          </div>
        );
        })}
      </div>
      {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
    </div>
  );
}
