import { InventoryItem, StockMovement, stockMovementTypeEnum } from "@shared/schema";
import { addDays, subDays, format, parse, isAfter, isBefore, isEqual } from "date-fns";

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
    movement.type === "SALE" || 
    movement.type === "ISSUE" // Using ISSUE as equivalent to USAGE
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

  // Group by week for forecast calculation (to reduce noise)
  const weeklyData: { [key: string]: number } = {};
  let startWeek = format(parsedStartDate, "yyyy-ww");
  let endWeek = format(parsedEndDate, "yyyy-ww");

  dateRange.forEach(point => {
    if (point.historical !== null) {
      const pointDate = parse(point.date, "yyyy-MM-dd", new Date());
      const weekNum = format(pointDate, "yyyy-ww");
      
      if (!weeklyData[weekNum]) {
        weeklyData[weekNum] = 0;
      }
      
      weeklyData[weekNum] += point.historical;
    }
  });

  // Calculate average weekly demand
  const weeklyDataPoints = Object.values(weeklyData);
  const weekCount = weeklyDataPoints.length;
  const nonZeroWeeks = weeklyDataPoints.filter(count => count > 0).length;
  
  // Simple moving average model
  // In a real app, this would be a more sophisticated algorithm
  let averageDemand = 0;
  if (weekCount > 0) {
    const totalDemand = weeklyDataPoints.reduce((sum, count) => sum + count, 0);
    // Use non-zero weeks to avoid underestimating due to periods with no demand
    averageDemand = nonZeroWeeks > 0 
      ? totalDemand / nonZeroWeeks 
      : totalDemand / weekCount;
  }

  // Calculate daily average (assume 7 days per week)
  const dailyAverageDemand = averageDemand / 7;

  // Generate forecast for dates in the future
  dateRange.forEach(point => {
    const pointDate = parse(point.date, "yyyy-MM-dd", new Date());
    
    // Only forecast future dates
    if (isAfter(pointDate, today)) {
      // Add randomness to make the forecast look more realistic
      const randomFactor = 0.8 + Math.random() * 0.4; // Between 0.8 and 1.2
      point.forecast = Math.round(dailyAverageDemand * randomFactor);
      
      // Add some seasonal patterns (example: weekend boost)
      const dayOfWeek = pointDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) { // Weekend
        point.forecast = Math.round(point.forecast * 1.3);
      }
    }
    
    // Calculate accuracy for dates where we have both historical and forecast
    // In a real app, this would be based on prior forecasts vs. actual values
    if (point.historical !== null && point.forecast !== null) {
      const diff = Math.abs(point.historical - point.forecast);
      const max = Math.max(point.historical, point.forecast);
      point.accuracy = max > 0 ? 1 - (diff / max) : 1;
    }
  });

  return dateRange;
}

/**
 * Get top items by demand
 */
export async function getTopItems(items: InventoryItem[], movements: StockMovement[], limit: number = 10): Promise<InventoryItem[]> {
  // Create a map to store demand by item ID
  const demandByItem: Map<number, number> = new Map();
  
  // Calculate total demand for each item
  movements.forEach(movement => {
    if (movement.type === "SALE" || movement.type === "ISSUE") {
      const itemId = movement.itemId;
      const currentDemand = demandByItem.get(itemId) || 0;
      demandByItem.set(itemId, currentDemand + Math.abs(movement.quantity));
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