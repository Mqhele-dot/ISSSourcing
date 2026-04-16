import { APP_ROUTES } from "@/lib/routes/app-routes";
import { asSectionSlug, ANALYTICS_SECTION_SLUGS, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";

export const ANALYTICS_NAV = [
  { label: "Overview", href: APP_ROUTES.analytics.overview },
  { label: "Inventory", href: APP_ROUTES.analytics.inventory },
  { label: "Procurement", href: APP_ROUTES.analytics.procurement },
  { label: "Finance", href: APP_ROUTES.analytics.finance },
  { label: "Logistics", href: APP_ROUTES.analytics.logistics },
  { label: "Reports", href: APP_ROUTES.analytics.reports },
  { label: "Saved reports", href: APP_ROUTES.analytics.savedReports },
  { label: "Export center", href: APP_ROUTES.analytics.exportCenter },
] as const;

export function getAnalyticsSection(pathname: string): AnalyticsSectionSlug {
  const slug = pathname.split("/")[2];
  return asSectionSlug(slug, ANALYTICS_SECTION_SLUGS, "overview");
}
