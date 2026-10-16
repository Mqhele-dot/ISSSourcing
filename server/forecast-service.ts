import type { InventoryItem, StockMovement} from "@shared/schema";
import { addDays, subDays, format, parse, isAfter, isBefore, isEqual } from "date-fns";

/** Unit value for analytics: prefer recorded cost; fall back to selling price when cost is unset. */
export function effectiveUnitCost(item: Pick<InventoryItem, "cost" | "price">): number {
  const c = Number(item.cost ?? 0);
  if (Number.isFinite(c) && c > 0) return c;
  const p = Number(item.price ?? 0);
  return Number.isFinite(p) ? p : 0;
}

export function inventoryLineValue(item: Pick<InventoryItem, "quantity" | "cost" | "price">): number {
  return Number(item.quantity ?? 0) * effectiveUnitCost(item);
}

interface DemandForecastPoint {
  date: string;
  itemId: number;
  itemName: string;
  historical: number | null;
  forecast: number | null;
  accuracy: number | null;
}

/**
 * Generate demand forecast based on historical data
 * In a real application, this would use actual statistical models or
 * machine learning algorithms to predict future demand
 */
export async function generateDemandForecast(
  item: InventoryItem,
  stockMovements: StockMovement[],
  daysToForecast: number = 30,
  startDate?: Date,
  endDate?: Date
): Promise<DemandForecastPoint[]> {
  // Parse date parameters or use defaults
  const today = new Date();
  const parsedStartDate = startDate 
    ? startDate
    : subDays(today, 60); // Default to last 60 days
  
  const parsedEndDate = endDate 
    ? endDate
    : addDays(today, 30); // Default to next 30 days

  // Create a date range for the forecast
  const dateRange: DemandForecastPoint[] = [];
  let currentDate = new Date(parsedStartDate);
  
  while (isBefore(currentDate, parsedEndDate) || isEqual(currentDate, parsedEndDate)) {
    dateRange.push({
      date: format(currentDate, "yyyy-MM-dd"),
      itemId: item.id,
      itemName: item.name,
      historical: null,
      forecast: null,
      accuracy: null
    });
    currentDate = addDays(currentDate, 1);
  }

  // Only consider outgoing movements (sales, usage) for demand calculation
  const demandMovements = stockMovements.filter(movement => 
    (movement.type === "SALE" || movement.type === "ISSUE") &&
    !/(test|return|transfer|reversal|damage|expir)/i.test(String(movement.referenceType ?? ""))
  );

  // Populate historical data
  demandMovements.forEach(movement => {
    const movementDate = new Date(movement.timestamp);
    const formattedDate = format(movementDate, "yyyy-MM-dd");
    
    // Find the date in our range
    const datePoint = dateRange.find(point => point.date === formattedDate);
    if (datePoint) {
      // Add the quantity to the historical data
      datePoint.historical = (datePoint.historical || 0) + Math.abs(movement.quantity);
    }
  });

  // Use complete observed calendar days, including days with zero demand. A recent
  // item without enough history has no forecast rather than an invented trend.
  const observedDays = Math.max(0, Math.floor((today.getTime() - parsedStartDate.getTime()) / 86_400_000));
  const historicalTotal = dateRange.reduce((sum, point) => {
    const date = parse(point.date, "yyyy-MM-dd", new Date());
    return isBefore(date, today) ? sum + (point.historical ?? 0) : sum;
  }, 0);
  const dailyAverageDemand = observedDays >= 14 ? historicalTotal / observedDays : null;

  // Generate forecast for dates in the future
  dateRange.forEach(point => {
    const pointDate = parse(point.date, "yyyy-MM-dd", new Date());
    
    // Only forecast future dates
    if (isAfter(pointDate, today)) {
      point.forecast = dailyAverageDemand === null ? null : Math.round(dailyAverageDemand * 100) / 100;
    }
    
    // Accuracy requires a saved forecast and a later observed actual; this
    // endpoint has no such evidence, so it must not claim an accuracy score.
    point.accuracy = null;
  });

  return dateRange;
}

/**
 * Get top items by demand
 */
export async function getTopItems(items: InventoryItem[], movements: StockMovement[], limit: number = 10): Promise<InventoryItem[]> {
  // Create a map to store demand by item ID
  const demandByItem: Map<number, number> = new Map();
  const OUT_TYPES = new Set(["SALE", "ISSUE"]);

  movements.forEach((movement) => {
    const t = String(movement.type ?? "").toUpperCase();
    const qty = Math.abs(Number(movement.quantity));
    if (!Number.isFinite(qty) || qty === 0) return;
    const itemId = movement.itemId;
    const currentDemand = demandByItem.get(itemId) || 0;
    if (OUT_TYPES.has(t) && !/(test|return|transfer|reversal|damage|expir)/i.test(String(movement.referenceType ?? ""))) {
      demandByItem.set(itemId, currentDemand + qty);
    }
  });
  
  // Sort items by demand
  const itemsWithDemand = items.filter(item => demandByItem.has(item.id));
  itemsWithDemand.sort((a, b) => {
    const demandA = demandByItem.get(a.id) || 0;
    const demandB = demandByItem.get(b.id) || 0;
    return demandB - demandA; // Sort in descending order
  });
  
  // Return top N items
  return itemsWithDemand.slice(0, limit);
}
