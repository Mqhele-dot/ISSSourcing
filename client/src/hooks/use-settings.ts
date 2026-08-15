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

  const { data: settings, isLoading, isError, error, refetch } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
    staleTime: 300000, // 5 minutes
    refetchOnWindowFocus: false,
  });

  const updateSettings = useMutation({
    mutationFn: async (newSettings: Partial<AppSettings>) => {
      const response = await apiRequest("PUT", "/api/settings", newSettings);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mdm/defaults/requisition-context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mdm/defaults/po-context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = String(query.queryKey[0] ?? "");
          return key.startsWith("/api/v2/procurement/") || key.startsWith("/api/sourcing/") || key.startsWith("/api/approval-suggestions");
        },
      });
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

  return {
    settings: settings ?? null,
    isLoading,
    isError,
    error,
    refetch,
    updateSettings,
  };
}
