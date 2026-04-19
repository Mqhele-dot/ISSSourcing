import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AppSettings, AppSettingsFormWithVat } from "@shared/schema";

// Define database settings type (includes form-only fields from database-settings-form)
export type DatabaseSettings = {
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  database?: string;
  autoConnect?: boolean;
  useLocalDB?: boolean;
  syncInterval?: number;
  offlineMode?: boolean;
  syncOnStartup?: boolean;
  maxOfflineDays?: number;
  compressionEnabled?: boolean;
};

// Re-export needed types
export { AppSettings, AppSettingsFormWithVat };

export function useSettings() {
  const { toast } = useToast();

  const { data: settings, isLoading, error } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
    staleTime: 300000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  // Default settings if API call fails or is loading
  const defaultSettings: AppSettings = {
    id: 1,
    organizationId: 1,
    companyName: "Inventory Manager",
    companyLogo: null,
    primaryColor: "#0f766e",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "HH:mm",
    currencySymbol: "$",
    currencyCode: "USD",
    lowStockDefaultThreshold: 10,
    allowNegativeInventory: false,
    requireLocationForItems: true,
    allowTransfersBetweenWarehouses: true,
    realTimeUpdatesEnabled: true,
    lowStockAlertFrequency: 30,
    autoReorderEnabled: false,
    forecastingEnabled: true,
    forecastDays: 30,
    seasonalAdjustmentEnabled: true,
    defaultWarehouseId: null,
    enableVat: false,
    defaultVatCountry: "US",
    showPricesWithVat: true,
    businessCountryCode: "US",
    taxMode: "none",
    productOnboardingCompletedAt: null,
    productOnboardingState: null,
    databaseSettings: null,
    updatedAt: new Date(),
    availableUnits: ["each", "kg", "liters", "boxes", "pieces", "meters", "pairs", "sets"],
    defaultUnit: "each",
    enableCustomTags: true,
    defaultTags: ["featured", "seasonal", "sale", "new", "discontinued"],
  };

  const updateSettings = useMutation({
    mutationFn: async (newSettings: Partial<AppSettings>) => {
      const response = await apiRequest("PUT", "/api/settings", newSettings);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings updated",
        description: "Your settings have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Return the actual settings if available, otherwise return default settings
  return {
    settings: settings || defaultSettings,
    isLoading,
    error,
    updateSettings,
  };
}