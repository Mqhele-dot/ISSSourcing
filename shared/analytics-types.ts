export type AnalyticsRisk = "low" | "medium" | "high" | "critical";
export type AnalyticsStatus = "good" | "warning" | "danger" | "neutral";

export interface AnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  businessArea?: string;
  supplierId?: number;
  warehouseId?: number;
  categoryId?: number;
  ownerId?: number;
  departmentId?: number;
  risk?: AnalyticsRisk;
  status?: string;
}

export interface AnalyticsKpi {
  label: string;
  value: number | string;
  previousValue?: number | string;
  changePercent?: number;
  trend?: "up" | "down" | "flat";
  status?: AnalyticsStatus;
  href?: string;
  helperText?: string;
  details?: Record<string, number | string | null>;
}

export interface ChartDatum {
  label: string;
  value: number;
  amount?: number;
  count?: number;
  status?: string;
  risk?: AnalyticsRisk;
  href?: string;
}

export interface TrendDatum {
  date: string;
  requisitions?: number;
  purchaseOrders?: number;
  receipts?: number;
  shipments?: number;
  invoices?: number;
  exceptionsOpened?: number;
  exceptionsResolved?: number;
}

export interface AnalyticsRecommendation {
  id: string;
  severity: AnalyticsRisk;
  area: string;
  title: string;
  reason: string;
  suggestedAction: string;
  href: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface AnalyticsPartialFailure {
  area: string;
  code: string;
  message: string;
  fallbackUsed: boolean;
}

export interface TableColumn {
  key: string;
  label: string;
  type?: "text" | "number" | "money" | "date" | "status" | "risk" | "link";
}

export interface TableData {
  columns: TableColumn[];
  rows: Array<Record<string, unknown>>;
  emptyTitle?: string;
  emptyDescription?: string;
}

export interface AnalyticsFilterOption {
  id: number;
  label: string;
  code?: string | null;
}

export interface AnalyticsResponse {
  generatedAt: string;
  meta: {
    queryMs: number;
    filtersApplied: Record<string, unknown>;
    dataFreshness: Record<string, string | null>;
    partialFailures: AnalyticsPartialFailure[];
  };
  filterOptions: {
    suppliers: AnalyticsFilterOption[];
    warehouses: AnalyticsFilterOption[];
    categories: AnalyticsFilterOption[];
    owners: AnalyticsFilterOption[];
    departments: AnalyticsFilterOption[];
  };
  kpis: Record<string, AnalyticsKpi>;
  charts: Record<string, ChartDatum[] | TrendDatum[]>;
  tables: Record<string, TableData>;
  recommendations: AnalyticsRecommendation[];
  dataQualityWarnings: Array<{ code: string; message: string; count: number; href: string }>;
  reportTemplates?: Array<{ id: string; label: string; href: string }>;
}
