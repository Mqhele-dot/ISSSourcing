import { Link, useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EntityDocumentsCard } from "@/components/documents/entity-documents-card";
import { useRequisitionFormRoute } from "@/pages/requisitions/use-requisition-form-route";
import { RequisitionLinesEditor } from "@/pages/requisitions/requisition-lines-editor";
import { ApprovalHistoryCard } from "@/components/procurement/approval-history-card";
import { useRequisitionForm } from "@/pages/requisitions/use-requisition-form";
import { RequisitionHeaderFields } from "@/pages/requisitions/requisition-header-fields";
import { RequisitionCommercialHintCard } from "@/pages/requisitions/requisition-commercial-hint-card";

export default function RequisitionFormPage() {
  const { id, isNew, listPath } = useRequisitionFormRoute();
  const [, setLocation] = useLocation();

  const f = useRequisitionForm({ id, isNew, listPath, setLocation });

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
          <RequisitionHeaderFields
            suppliers={f.suppliers}
            departments={f.departments}
            currencies={f.currencies}
            projects={f.extensionProjects}
            supplierId={f.supplierId}
            currencyCode={f.currencyCode}
            exchangeRateToZar={f.exchangeRateToZar}
            requisitionTotals={f.requisitionTotals}
            departmentId={f.departmentId}
            projectId={f.projectId}
            requiredDate={f.requiredDate}
            justification={f.justification}
            notes={f.notes}
            fieldErrors={f.fieldErrors}
            readOnly={f.isLocked}
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
          />

          <RequisitionLinesEditor
            items={f.items}
            inventoryItems={f.inventoryItems}
            unitsOfMeasure={f.unitsOfMeasure}
            taxCodes={f.taxCodes}
            costCentres={f.costCentres}
            currencyCode={f.currencyCode}
            exchangeRateToZar={f.exchangeRateToZar}
            fieldError={f.fieldErrors.items}
            onAddRow={f.addItem}
            onRemoveRow={f.removeItem}
            onUpdateRow={f.updateItem}
            readOnly={f.isLocked}
            lockedReason={f.lockedReason}
          />

          <div className="flex gap-2">
            <Button onClick={f.handleSubmit} disabled={f.isPending || f.isLocked}>
              {f.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isNew ? "Create" : "Update"}
            </Button>
            <Button variant="outline" asChild>
              <Link href={listPath}>Cancel</Link>
            </Button>
          </div>
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
