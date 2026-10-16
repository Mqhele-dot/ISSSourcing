import { eq } from "drizzle-orm";
import { appSettings, organizationSettings, organizations } from "@shared/schema";
import { db } from "../db";
import { getActiveOrganizationId } from "../organization-context";
import { loadLogoBytesForPdf } from "./pdf-logo-loader";

export type OrganizationDocumentBranding = {
  organizationId: number;
  displayName: string;
  legalName: string;
  registrationNumber: string | null;
  taxNumber: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  logoUrl: string | null;
  reportFooter: string;
  logoBytes?: Uint8Array;
};

function clean(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export async function getOrganizationDocumentBranding(
  organizationId = getActiveOrganizationId(),
  options: { loadLogo?: boolean } = {},
): Promise<OrganizationDocumentBranding> {
  const [row] = await db
    .select({
      organizationName: organizations.name,
      displayName: organizationSettings.displayName,
      legalName: organizationSettings.legalName,
      registrationNumber: organizationSettings.registrationNumber,
      taxNumber: organizationSettings.taxNumber,
      address: organizationSettings.address,
      contactEmail: organizationSettings.contactEmail,
      contactPhone: organizationSettings.contactPhone,
      website: organizationSettings.website,
      logoUrl: organizationSettings.logoUrl,
      customFooter: organizationSettings.reportFooter,
      settingsCompanyName: appSettings.companyName,
      settingsLogo: appSettings.companyLogo,
    })
    .from(organizations)
    .leftJoin(organizationSettings, eq(organizationSettings.organizationId, organizations.id))
    .leftJoin(appSettings, eq(appSettings.organizationId, organizations.id))
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const displayName = clean(row?.displayName) ?? clean(row?.settingsCompanyName) ?? clean(row?.organizationName) ?? "Organization";
  const legalName = clean(row?.legalName) ?? displayName;
  const registrationNumber = clean(row?.registrationNumber);
  const taxNumber = clean(row?.taxNumber);
  const address = clean(row?.address);
  const contactEmail = clean(row?.contactEmail);
  const contactPhone = clean(row?.contactPhone);
  const website = clean(row?.website);
  const logoUrl = clean(row?.logoUrl) ?? clean(row?.settingsLogo);
  const legalDetails = [
    legalName,
    registrationNumber ? `Registration ${registrationNumber}` : null,
    taxNumber ? `Tax ${taxNumber}` : null,
    address,
    contactEmail,
    contactPhone,
    website,
    clean(row?.customFooter),
  ].filter((value): value is string => Boolean(value));
  const logoBytes = options.loadLogo && logoUrl ? await loadLogoBytesForPdf(logoUrl) : undefined;

  return {
    organizationId,
    displayName,
    legalName,
    registrationNumber,
    taxNumber,
    address,
    contactEmail,
    contactPhone,
    website,
    logoUrl,
    reportFooter: legalDetails.join(" | "),
    ...(logoBytes?.length ? { logoBytes } : {}),
  };
}
