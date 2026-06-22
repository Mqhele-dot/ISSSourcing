import type { Category, InventoryItem } from "@shared/schema";

/** Match server analytics: prefer cost, fall back to price when cost is unset/zero. */
export function effectiveUnitValue(item: Pick<InventoryItem, "cost" | "price">): number {
  const c = Number(item.cost ?? 0);
  if (Number.isFinite(c) && c > 0) return c;
  const p = Number(item.price ?? 0);
  return Number.isFinite(p) ? p : 0;
}

export function lineInventoryValue(item: Pick<InventoryItem, "quantity" | "cost" | "price">): number {
  return Number(item.quantity ?? 0) * effectiveUnitValue(item);
}

export type CategoryValueRow = { name: string; fullName: string; value: number };

/** Value by category — works even when /api/categories is empty (names resolved from ids). */
export function aggregateValueByCategory(
  items: InventoryItem[],
  categories: Category[],
  maxSlice = 8,
  labelMax = 10,
): CategoryValueRow[] {
  const nameById = new Map<number, string>();
  categories.forEach((c) => nameById.set(c.id, c.name));

  const buckets: Record<number, { name: string; value: number }> = {};

  for (const item of items) {
    const catId = item.categoryId ?? 0;
    if (!buckets[catId]) {
      const label =
        catId === 0 ? "Uncategorized" : nameById.get(catId) ?? `Category #${catId}`;
      buckets[catId] = { name: label, value: 0 };
    }
    buckets[catId].value += lineInventoryValue(item);
  }

  return Object.values(buckets)
    .filter((v) => v.value > 0)
    .map((v) => ({
      name: v.name.length > labelMax ? `${v.name.slice(0, labelMax)}…` : v.name,
      fullName: v.name,
      value: v.value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxSlice);
}

export type CategoryCountRow = { name: string; fullName: string; value: number };

export function aggregateCountByCategory(
  items: InventoryItem[],
  categories: Category[],
  maxSlice = 10,
): CategoryCountRow[] {
  const nameById = new Map<number, string>();
  categories.forEach((c) => nameById.set(c.id, c.name));

  const buckets: Record<number, { name: string; count: number }> = {};
  for (const item of items) {
    const catId = item.categoryId ?? 0;
    if (!buckets[catId]) {
      const label =
        catId === 0 ? "Uncategorized" : nameById.get(catId) ?? `Category #${catId}`;
      buckets[catId] = { name: label, count: 0 };
    }
    buckets[catId].count += 1;
  }

  return Object.values(buckets)
    .filter((v) => v.count > 0)
    .map((v) => ({
      name: v.name.length > 14 ? `${v.name.slice(0, 14)}…` : v.name,
      fullName: v.name,
      value: v.count,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, maxSlice);
}
