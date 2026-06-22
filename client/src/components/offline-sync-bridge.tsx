import { useAuth } from "@/hooks/use-auth";
import { useOfflineSyncFlush } from "@/hooks/use-offline-sync-flush";

/** Mount once under AuthProvider to sync offline queue when the user is signed in. */
export function OfflineSyncBridge() {
  const { user } = useAuth();
  useOfflineSyncFlush(!!user);
  return null;
}
