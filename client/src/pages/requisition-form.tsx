import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";
import { useRequisitionFormRoute } from "@/pages/requisitions/use-requisition-form-route";
import { RequisitionLinesEditor } from "@/pages/requisitions/requisition-lines-editor";
import { ApprovalHistoryCard } from "@/components/procurement/approval-history-card";
import { useRequisitionForm } from "@/pages/requisitions/use-requisition-form";
import { RequisitionHeaderFields } from "@/pages/requisitions/requisition-header-fields";
import { RequisitionCommercialHintCard } from "@/pages/requisitions/requisition-commercial-hint-card";
import { requestJson } from "@/lib/queryClient";

export default function RequisitionFormPage() {
  const { id, isNew, listPath } = useRequisitionFormRoute();
  const [, setLocation] = useLocation();

  const f = useRequisitionForm({ id, isNew, listPath, setLocation });
  const recent = useQuery({
    queryKey: ["/api/v2/procurement/requisitions", "copy-picker"],
    queryFn: () => requestJson<{ items: Array<{ id: number; requisitionNumber: string }> }>("GET", "/api/v2/procurement/requisitions?page=1&pageSize=25"),
    enabled: isNew,
  });
  const recentOrders = useQuery({
    queryKey: ["/api/v2/procurement/purchase-orders/recent"],
    queryFn: () => requestJson<{ items: Array<{ id: number; orderNumber: string }> }>("GET", "/api/v2/procurement/purchase-orders/recent"),
    enabled: isNew,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="requisition-form-page">
      <PageHeader
        title={isNew ? "New Requisition" : `Edit ${f.requisition?.requisitionNumber ?? ""}`}
        subtitle={isNew ? "Create a purchase requisition" : "Update requisition details"}
        breadcrumb={
          <Link href={listPath} className="text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back to Requisitions
          </Link>
        }
      />

      {!isNew && id ? <Button variant="outline" asChild><Link href={`${listPath}/new?copyFrom=${id}`}>Copy to new draft</Link></Button> : null}
      {isNew ? <div className="rounded-md border p-3 text-sm">
        <label htmlFor="recent-requisition">Copy a recent requisition</label>
        <select id="recent-requisition" className="ml-2 rounded border p-2" value="" onChange={(event) => { if (event.target.value) setLocation(`${listPath}/new?copyFrom=${event.target.value}`); }}>
          <option value="">Start without copying</option>
          {(recent.data?.items ?? []).slice(0, 10).map((row) => <option key={row.id} value={row.id}>{row.requisitionNumber}</option>)}
        </select>
        <label htmlFor="recent-po" className="ml-3">Repeat a recent PO</label>
        <select id="recent-po" className="ml-2 rounded border p-2" value="" onChange={(event) => { if (event.target.value) setLocation(`${listPath}/new?copyPoFrom=${event.target.value}`); }}>
          <option value="">Choose purchase order</option>
          {(recentOrders.data?.items ?? []).map((row) => <option key={row.id} value={row.id}>{row.orderNumber}</option>)}
        </select>
        {f.copySource ? <p className="mt-2">Copied from {f.copySource.requisitionNumber}. This is a new draft; approvals and history were not copied. Review prices and dates before saving.</p> : null}
        {f.copyPoSource ? <p className="mt-2">Repeated from PO {f.copyPoSource.orderNumber} as a new requisition draft. The new purchase still needs independent approval before it can become a PO.</p> : null}
        {f.copySourceError ? <p role="alert" className="text-destructive">Could not load the source requisition. Choose another or start without copying.</p> : null}
        {f.copyWarnings.map((warning) => <p role="alert" className="text-amber-700" key={warning}>{warning}</p>)}
      </div> : null}

      {!isNew && f.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6" role="form" aria-label="Purchase requisition form">
          {f.isLocked ? (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="requisition-header-locked-message"
            >
              {f.lockedReason}
            </div>
          ) : null}
          {f.mdmError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
              <span>Authoritative procurement Master Data could not be loaded. Saving is disabled until it is available.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void f.refetchMdm()}>Retry Master Data</Button>
            </div>
          ) : null}
          <RequisitionHeaderFields
            suppliers={f.suppliers}
            departments={f.departments}
            currencies={f.currencies}
            projects={f.extensionProjects}
            supplierId={f.supplierId}
            currencyCode={f.currencyCode}
            exchangeRateToZar={f.exchangeRateToZar}
            reportingCurrencyCode={f.reportingCurrencyCode}
            requisitionTotals={f.requisitionTotals}
            departmentId={f.departmentId}
            projectId={f.projectId}
            requiredDate={f.requiredDate}
            justification={f.justification}
            notes={f.notes}
            fieldErrors={f.fieldErrors}
            requiresDepartment={f.mdmContext?.rules.requiresDepartment !== false}
            readOnly={f.isLocked}
            suppliersLoading={f.isMdmLoading}
            onSupplierChange={f.setSupplierId}
            onCurrencyChange={f.setCurrencyCode}
            onCreateSupplier={f.createSupplier}
            onDepartmentChange={f.setDepartmentId}
            onProjectChange={f.setProjectId}
            onRequiredDateChange={f.setRequiredDate}
            onJustificationChange={f.setJustification}
            onNotesChange={f.setNotes}
          />

          <RequisitionCommercialHintCard
            supplierId={f.supplierId}
            suppliers={f.suppliers}
            departmentLabel={f.departmentLabel}
            currencies={f.currencies}
            contractsForSupplier={f.contractsForSupplier}
            paymentTerms={f.paymentTerms}
            incoterms={f.incoterms}
            taxCodes={f.taxCodes}
            reportingCurrencyCode={f.reportingCurrencyCode}
          />

          <RequisitionLinesEditor
            items={f.items}
            inventoryItems={f.inventoryItems}
            unitsOfMeasure={f.unitsOfMeasure}
            taxCodes={f.taxCodes}
            costCentres={f.costCentres}
            currencyCode={f.currencyCode}
            exchangeRateToZar={f.exchangeRateToZar}
            reportingCurrencyCode={f.reportingCurrencyCode}
            fieldError={f.fieldErrors.items}
            rules={f.mdmContext?.rules}
            onAddRow={f.addItem}
            onRemoveRow={f.removeItem}
            onUpdateRow={f.updateItem}
            readOnly={f.isLocked}
            lockedReason={f.lockedReason}
          />

          <div className="flex gap-2">
            <Button onClick={f.handleSubmit} disabled={f.isPending || !f.canSubmit} data-testid="requisition-save-button" aria-describedby={!f.canSubmit ? "requisition-submit-readiness" : undefined}>
              {f.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? "Create" : "Update"}
            </Button>
            <Button variant="outline" asChild>
              <Link href={listPath}>Cancel</Link>
            </Button>
            {!isNew && id && String(f.requisition?.status).toUpperCase() === "APPROVED" ? (
              <Button variant="outline" asChild data-testid="requisition-start-rfq">
                <Link href={`/procurement/sourcing?requisitionId=${id}`}>
                  <Scale className="mr-2 h-4 w-4" />
                  Start controlled RFQ
                </Link>
              </Button>
            ) : null}
          </div>
          {!f.canSubmit && !f.isLocked ? <p id="requisition-submit-readiness" className="text-sm text-muted-foreground" aria-live="polite">Complete required setup before saving: {f.submitBlockers[0]}.</p> : null}
          {!isNew && id ? (
            <>
              <ApprovalHistoryCard entityType="requisition" entityId={id} />
              <EntityDocumentsCard entityType="requisition" entityId={id} title="Requisition Attachments" />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
