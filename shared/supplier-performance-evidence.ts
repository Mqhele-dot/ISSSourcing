/** Evidence-based rates: absence of observations is not a successful outcome. */
export function supplierPerformanceEvidence(ordersMeasured: number, onTime: number, invoicesMeasured: number, disputed: number) {
  const round = (value: number) => Math.round(value * 10) / 10;
  const onTimeDeliveryRate = ordersMeasured > 0 ? round(onTime / ordersMeasured * 100) : null;
  const priceComplianceRate = invoicesMeasured > 0 ? round((invoicesMeasured - disputed) / invoicesMeasured * 100) : null;
  const overallRating = onTimeDeliveryRate === null || priceComplianceRate === null
    ? null : round((onTimeDeliveryRate * 0.6 + priceComplianceRate * 0.4) / 20);
  return { onTimeDeliveryRate, priceComplianceRate, overallRating, ordersMeasured, invoicesMeasured,
    evidenceState: overallRating === null ? "insufficient_evidence" : "observed",
    methodology: "First receipt against promised date; undisputed invoice rate is a proxy, not verified contract-price compliance." };
}
