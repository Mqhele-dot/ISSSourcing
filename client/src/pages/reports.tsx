import { useState } from "react";
import { useLocation } from "wouter";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import type { DocumentType } from "@shared/schema";
import { type ReportFilter } from "@shared/schema";
import { QueryState } from "@/components/ui/query-state";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { useReportsPageData } from "@/pages/reports/use-reports-data";
import { useReportsExport } from "@/pages/reports/use-reports-export";
import { ReportsExportToolbar } from "@/pages/reports/reports-export-toolbar";
import type { ReportTab } from "@/pages/reports/reports-types";
import {
  ReportsInventoryTabPanel,
  ReportsInvoicesTabPanel,
  ReportsLowStockTabPanel,
  ReportsPurchaseOrdersTabPanel,
  ReportsPurchaseRequisitionsTabPanel,
  ReportsReorderRequestsTabPanel,
  ReportsShipmentsTabPanel,
  ReportsSuppliersTabPanel,
  ReportsValueTabPanel,
  type ReportsTabPanelsProps,
} from "@/pages/reports/reports-tab-panels";
import { APP_ROUTES, REPORT_SECTION_SLUGS, asSectionSlug } from "@/lib/routes/app-routes";
import { SectionNav } from "@/components/section-nav";

export default function Reports() {
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const routeTab = asSectionSlug(location.split("/")[3], REPORT_SECTION_SLUGS, "inventory") as ReportTab;
  const [exportFormat, setExportFormat] = useState<DocumentType>("pdf");
  const [pdfTemplate, setPdfTemplate] = useState<"standard" | "compact" | "custom">("standard");
  const [customTemplateFile, setCustomTemplateFile] = useState<File | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [filter, setFilter] = useState<ReportFilter>({});

  const {
    safeInventoryItems,
    safeLowStockItems,
    safeCategories,
    safeWarehouses,
    safeSuppliers,
    safePurchaseOrders,
    safePurchaseRequisitions,
    safeReorderRequests,
    safeProjects,
    poLoading,
    requisitionsLoading,
    reorderLoading,
    stats,
    itemsLoading,
    itemsError,
    itemsErrorDetail,
    refetchInventory,
    lowStockLoading,
  } = useReportsPageData();

  const isInventoryReportTab =
    routeTab === "inventory" || routeTab === "low-stock" || routeTab === "value";

  const { exporting, handleExport } = useReportsExport({
    activeTab: routeTab,
    exportFormat,
    pdfTemplate,
    filter,
    toast,
  });

  const handleFilterChange = (newFilter: ReportFilter) => {
    setFilter(newFilter);
  };

  const handlePdfTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTemplate(true);
    try {
      const formData = new FormData();
      formData.append("template", file);
      const res = await fetch("/api/settings/pdf-template", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Upload failed");
      }
      setCustomTemplateFile(file);
      toast({ title: "Template uploaded", description: "Use Export to generate PDF with your template." });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Could not upload template",
        variant: "destructive",
      });
    } finally {
      setUploadingTemplate(false);
      e.target.value = "";
    }
  };

  const getCategoryName = (categoryId: number | null | undefined): string => {
    if (!categoryId) return "Uncategorized";
    const category = safeCategories.find((c) => c.id === categoryId);
    return category?.name || "Uncategorized";
  };

  const calculateTotalValue = (items: unknown): number => {
    const arr = Array.isArray(items) ? items : [];
    return arr.reduce(
      (total: number, item: { price?: number; quantity?: number }) =>
        total + (Number(item?.price) || 0) * (Number(item?.quantity) || 0),
      0,
    );
  };

  const tabPanelProps: ReportsTabPanelsProps = {
    filter,
    onFilterChange: handleFilterChange,
    safeCategories,
    safeWarehouses,
    safeInventoryItems,
    safeLowStockItems,
    safePurchaseOrders,
    safePurchaseRequisitions,
    safeReorderRequests,
    safeSuppliers,
    safeProjects,
    itemsLoading,
    lowStockLoading,
    poLoading,
    requisitionsLoading,
    reorderLoading,
    stats,
    getCategoryName,
    calculateTotalValue,
  };

  return (
    <QueryState
      isLoading={isInventoryReportTab ? itemsLoading : false}
      isError={isInventoryReportTab ? itemsError : false}
      error={isInventoryReportTab && itemsErrorDetail instanceof Error ? itemsErrorDetail : null}
      refetch={refetchInventory}
    >
      <PageShell variant="wide-table">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <PageHeader title="Reports" description="Structured tabular outputs backed by the shared export service." />
          </div>
          <div className="w-full shrink-0 lg:max-w-xl lg:pt-1">
            <ReportsExportToolbar
              exportFormat={exportFormat}
              onExportFormatChange={(v) => setExportFormat(v)}
              pdfTemplate={pdfTemplate}
              onPdfTemplateChange={(v) => setPdfTemplate(v)}
              customTemplateFile={customTemplateFile}
              uploadingTemplate={uploadingTemplate}
              onTemplateFileChange={handlePdfTemplateUpload}
              exporting={exporting}
              onExport={handleExport}
            />
          </div>
        </div>

        <SectionNav
          items={[
            { label: "Inventory", href: APP_ROUTES.analytics.reportSection("inventory") },
            { label: "Low stock", href: APP_ROUTES.analytics.reportSection("low-stock") },
            { label: "Value", href: APP_ROUTES.analytics.reportSection("value") },
            { label: "Purchase orders", href: APP_ROUTES.analytics.reportSection("purchase-orders") },
            { label: "Requisitions", href: APP_ROUTES.analytics.reportSection("purchase-requisitions") },
            { label: "Suppliers", href: APP_ROUTES.analytics.reportSection("suppliers") },
            { label: "Reorder", href: APP_ROUTES.analytics.reportSection("reorder-requests") },
            { label: "Invoices", href: APP_ROUTES.analytics.reportSection("invoices") },
            { label: "Shipments", href: APP_ROUTES.analytics.reportSection("shipments") },
          ]}
        />

        <Tabs
          value={routeTab}
          onValueChange={(value) => {
            navigate(APP_ROUTES.analytics.reportSection(value as ReportTab));
          }}
          className="space-y-4"
        >
          <ReportsInventoryTabPanel {...tabPanelProps} />
          <ReportsLowStockTabPanel {...tabPanelProps} />
          <ReportsValueTabPanel {...tabPanelProps} />
          <ReportsPurchaseOrdersTabPanel {...tabPanelProps} />
          <ReportsPurchaseRequisitionsTabPanel {...tabPanelProps} />
          <ReportsSuppliersTabPanel {...tabPanelProps} />
          <ReportsReorderRequestsTabPanel {...tabPanelProps} />
          <ReportsInvoicesTabPanel {...tabPanelProps} />
          <ReportsShipmentsTabPanel {...tabPanelProps} />
        </Tabs>
      </PageShell>
    </QueryState>
  );
}
