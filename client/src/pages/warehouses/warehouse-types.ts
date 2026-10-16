/** Shared types + validation for warehouses page (split from monolithic page). */

export interface Warehouse {
  id: number;
  name: string;
  address: string | null;
  location: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  isDefault: boolean | null;
  aisle?: string | null;
  aisles?: string[] | null;
  bins?: { code: string; aisle?: string; row?: string; shelf?: string }[] | null;
  locationDetails?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BinLocation {
  code: string;
  aisle?: string;
  row?: string;
  shelf?: string;
}

export interface FormData {
  name: string;
  address: string;
  location: string;
  contactPerson: string;
  contactPhone: string;
  isDefault: boolean;
  aisles: string;
  bins: BinLocation[];
  locationDetails: string;
}

export interface WarehousePayload {
  name: string;
  address: string | null;
  location: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  isDefault: boolean;
  aisles?: string[];
  bins?: { code: string; aisle?: string; row?: string; shelf?: string }[];
  locationDetails?: Record<string, unknown>;
}

export const emptyWarehouseForm = (): FormData => ({
  name: "",
  address: "",
  location: "",
  contactPerson: "",
  contactPhone: "",
  isDefault: false,
  aisles: "",
  bins: [],
  locationDetails: "",
});

export function validateWarehouseForm(data: FormData): string | null {
  if (!data.name.trim()) return "Warehouse name is required";
  return null;
}

export function warehouseFormToPayload(data: FormData): WarehousePayload {
  const aisles = data.aisles
    ? data.aisles
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const bins = data.bins
    .filter((b) => b.code.trim())
    .map((b) => ({
      code: b.code.trim(),
      aisle: b.aisle?.trim() || undefined,
      row: b.row?.trim() || undefined,
      shelf: b.shelf?.trim() || undefined,
    }));
  let locationDetails: Record<string, unknown> | null = null;
  if (data.locationDetails.trim()) {
    try {
      locationDetails = JSON.parse(data.locationDetails) as Record<string, unknown>;
    } catch {
      locationDetails = { raw: data.locationDetails };
    }
  }
  return {
    name: data.name.trim(),
    address: data.address || null,
    location: data.location || null,
    contactPerson: data.contactPerson || null,
    contactPhone: data.contactPhone || null,
    isDefault: data.isDefault,
    aisles: aisles.length ? aisles : undefined,
    bins: bins.length ? bins : undefined,
    locationDetails: locationDetails ?? undefined,
  };
}
