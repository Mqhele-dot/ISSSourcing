import { useQuery } from "@tanstack/react-query";
import { normalizeApiListStrict, requestJson } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";

export type SupplierPerformanceRow = {
  supplierId: number;
  supplierName: string;
  onTimeDeliveryRate: number;
  priceComplianceRate: number;
  ordersMeasured: number;
  invoicesMeasured: number;
  overallRating: number;
};

/** Primary list + reference data for the suppliers page (colocated hook). */
export function useSuppliersCoreQueries(filters: { q: string; status: string; page: number; pageSize: number }) {
  const suppliersQuery = useQuery<{ items: Supplier[]; total: number; page: number; pageSize: number; hasNext: boolean }>({
    queryKey: ["/api/v2/suppliers", filters],
    retry: 1,
    queryFn: async () => {
      return requestJson("GET", `/api/v2/suppliers?page=${filters.page}&pageSize=${filters.pageSize}&q=${encodeURIComponent(filters.q)}&status=${filters.status === "all" ? "" : filters.status}&sort=name_asc`);
    },
  });

  const paymentTermsQuery = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["/api/payment-terms"],
    queryFn: () => requestJson("GET", "/api/payment-terms"),
    throwOnError: false,
  });

  const currenciesQuery = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["/api/currencies"],
    queryFn: () => requestJson("GET", "/api/currencies"),
    throwOnError: false,
  });

  const carriersQuery = useQuery<{ id: number; code?: string | null; name: string; active?: boolean | null }[]>({
    queryKey: ["/api/carriers"],
    queryFn: () => requestJson("GET", "/api/carriers"),
    throwOnError: false,
  });

  const taxCodesQuery = useQuery<{ id: number; code: string; name: string; active?: boolean | null }[]>({
    queryKey: ["/api/tax-codes"],
    queryFn: () => requestJson("GET", "/api/tax-codes"),
    throwOnError: false,
  });

  const incotermsQuery = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["/api/incoterms"],
    queryFn: () => requestJson("GET", "/api/incoterms"),
    throwOnError: false,
  });

  const departmentsQuery = useQuery<{ id: number; code: string; name: string }[]>({
    queryKey: ["/api/departments"],
    queryFn: () => requestJson("GET", "/api/departments"),
    throwOnError: false,
  });

  const contractsQuery = useQuery<{ id: number; title: string; supplierId: number; status?: string | null }[]>({
    queryKey: ["/api/contracts"],
    queryFn: () => requestJson("GET", "/api/contracts"),
    throwOnError: false,
  });

  const visibleIds = suppliersQuery.data?.items.map((supplier) => supplier.id) ?? [];
  const performanceQuery = useQuery<SupplierPerformanceRow[]>({
    queryKey: ["/api/v2/suppliers/performance", visibleIds],
    enabled: visibleIds.length > 0,
    queryFn: () => requestJson("GET", `/api/v2/suppliers/performance?ids=${visibleIds.join(",")}`),
    throwOnError: false,
  });

  return {
    suppliersQuery,
    paymentTermsQuery,
    currenciesQuery,
    carriersQuery,
    taxCodesQuery,
    incotermsQuery,
    departmentsQuery,
    contractsQuery,
    performanceQuery,
  };
}
