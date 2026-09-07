export const COUNTRY_PACK_CODES = ["ZA", "GB", "US"] as const;
export type CountryPackCode = (typeof COUNTRY_PACK_CODES)[number];

export type CountryPack = {
  code: CountryPackCode;
  name: string;
  locale: string;
  timezone: string;
  defaultCurrencyCode: string;
  taxLabel: string;
  registrationLabel: string;
  bankFields: readonly string[];
  supplierCompliance: readonly string[];
  retentionYears: number;
};

export const COUNTRY_PACKS: Record<CountryPackCode, CountryPack> = {
  ZA: {
    code: "ZA",
    name: "South Africa",
    locale: "en-ZA",
    timezone: "Africa/Johannesburg",
    defaultCurrencyCode: "ZAR",
    taxLabel: "VAT",
    registrationLabel: "Company registration number",
    bankFields: ["bankName", "accountNumber", "branchCode", "accountType"],
    supplierCompliance: ["taxClearance", "bankVerification", "companyRegistration"],
    retentionYears: 7,
  },
  GB: {
    code: "GB",
    name: "United Kingdom",
    locale: "en-GB",
    timezone: "Europe/London",
    defaultCurrencyCode: "GBP",
    taxLabel: "VAT",
    registrationLabel: "Companies House number",
    bankFields: ["bankName", "accountNumber", "sortCode", "iban", "swiftCode"],
    supplierCompliance: ["vatRegistration", "bankVerification", "companyRegistration"],
    retentionYears: 6,
  },
  US: {
    code: "US",
    name: "United States",
    locale: "en-US",
    timezone: "America/New_York",
    defaultCurrencyCode: "USD",
    taxLabel: "Sales tax",
    registrationLabel: "Federal or state registration number",
    bankFields: ["bankName", "accountNumber", "routingNumber", "accountType"],
    supplierCompliance: ["taxForm", "bankVerification", "businessRegistration"],
    retentionYears: 7,
  },
};

export function getCountryPack(value: string | null | undefined): CountryPack {
  const code = String(value ?? "ZA").trim().toUpperCase() as CountryPackCode;
  return COUNTRY_PACKS[code] ?? COUNTRY_PACKS.ZA;
}

export function listCountryPacks(): CountryPack[] {
  return COUNTRY_PACK_CODES.map((code) => COUNTRY_PACKS[code]);
}
