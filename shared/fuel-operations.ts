export const FUEL_RECONCILIATION_TOLERANCE_LITRES = 0.5;

export function calculateFuelReconciliation(input: {
  openingMeterLitres: number;
  closingMeterLitres: number;
  reportedSalesLitres: number;
  toleranceLitres?: number;
}) {
  if (![input.openingMeterLitres, input.closingMeterLitres, input.reportedSalesLitres].every(Number.isFinite)) {
    throw new Error("Fuel reconciliation values must be finite numbers.");
  }
  if (input.openingMeterLitres < 0 || input.reportedSalesLitres < 0) {
    throw new Error("Fuel reconciliation values cannot be negative.");
  }
  if (input.closingMeterLitres < input.openingMeterLitres) {
    throw new Error("Closing meter must be at least the opening meter.");
  }
  const measuredSalesLitres = input.closingMeterLitres - input.openingMeterLitres;
  const varianceLitres = input.reportedSalesLitres - measuredSalesLitres;
  const toleranceLitres = input.toleranceLitres ?? FUEL_RECONCILIATION_TOLERANCE_LITRES;
  return {
    measuredSalesLitres,
    varianceLitres,
    status: Math.abs(varianceLitres) <= toleranceLitres ? "balanced" as const : "variance" as const,
  };
}

export function tankFillPercent(currentLevelLitres: number, capacityLitres: number): number {
  if (!Number.isFinite(currentLevelLitres) || !Number.isFinite(capacityLitres) || capacityLitres <= 0) return 0;
  return Math.max(0, Math.min(100, (currentLevelLitres / capacityLitres) * 100));
}
