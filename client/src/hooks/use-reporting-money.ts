import { useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";
import { createReportingMoneyFormatter } from "@/lib/format/reporting-money";

/**
 * Org-scoped currency formatting from app settings (`currencyCode` ISO 4217).
 */
export function useReportingMoney() {
  const { settings } = useSettings();
  const currencyCode = settings.currencyCode?.trim() || "USD";

  return useMemo(() => {
    const formatter = createReportingMoneyFormatter(currencyCode);
    return {
      formatMoney: formatter.formatMoney,
      currencyCode: formatter.currencyCode,
    };
  }, [currencyCode]);
}
