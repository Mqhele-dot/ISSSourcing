import { APP_ROUTES } from "@/lib/routes/app-routes";

export const PHONE_OPERATIONS_MEDIA_QUERY = "(max-width: 767px)";

export function phoneOperationsTarget(search = ""): string {
  const suffix = search && !search.startsWith("?") ? `?${search}` : search;
  return `${APP_ROUTES.operations.mobileHub}${suffix}`;
}
