import { useState } from "react";
import {
  BarChart2,
  ClipboardList,
  FileText,
  FileSpreadsheet,
  PackageSearch,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import type { DocumentType } from "@shared/schema";
import { type ReportFilter } from "@shared/schema";
import { QueryState } from "@/components/ui/query-state";
import { PageHeader } from "@/components/page-header";
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

export default function Reports() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportTab>("inventory");
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
    activeTab === "inventory" || activeTab === "low-stock" || activeTab === "value";

  const { exporting, handleExport } = useReportsExport({
    activeTab,
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
      <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <PageHeader title="Reports" description="Generate and export inventory reports in multiple formats" />
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

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReportTab)} className="space-y-4">
          <TabsList
            className="mb-0 inline-flex h-auto w-full max-w-full flex-nowrap justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-md bg-muted/40 p-1"
            data-tour="reports-tabs"
          >
            <TabsTrigger value="inventory" className="flex shrink-0 items-center whitespace-nowrap">
              <FileText className="mr-2 h-4 w-4" />
              Inventory Report
            </TabsTrigger>
            <TabsTrigger value="low-stock" className="flex shrink-0 items-center whitespace-nowrap">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Low Stock Report
            </TabsTrigger>
            <TabsTrigger value="value" className="flex shrink-0 items-center whitespace-nowrap">
              <BarChart2 className="mr-2 h-4 w-4" />
              Value Report
            </TabsTrigger>
            <TabsTrigger value="purchase-orders" className="flex shrink-0 items-center whitespace-nowrap">
              <ShoppingCart className="mr-2 h-4 w-4" />
              Purchase Orders
            </TabsTrigger>
            <TabsTrigger value="purchase-requisitions" className="flex shrink-0 items-center whitespace-nowrap">
              <ClipboardList className="mr-2 h-4 w-4" />
              Requisitions
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="flex shrink-0 items-center whitespace-nowrap">
              <Users className="mr-2 h-4 w-4" />
              Suppliers
            </TabsTrigger>
            <TabsTrigger value="reorder-requests" className="flex shrink-0 items-center whitespace-nowrap">
              <PackageSearch className="mr-2 h-4 w-4" />
              Reorder Requests
            </TabsTrigger>
            <TabsTrigger value="invoices" className="flex shrink-0 items-center whitespace-nowrap">
              <Receipt className="mr-2 h-4 w-4" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="shipments" className="flex shrink-0 items-center whitespace-nowrap">
              <Truck className="mr-2 h-4 w-4" />
              Shipments
            </TabsTrigger>
          </TabsList>

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
      </div>
    </QueryState>
  );
}
