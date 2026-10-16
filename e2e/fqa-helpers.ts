import { expect, type Page } from "@playwright/test";

/** SKUs installed by seed:functional-qa (subset checks when demo data coexists). */
export const FQA_SKU_LIST = ["SKU-A", "SKU-B", "SKU-C", "SKU-D"] as const;

export async function visibleFqaSkus(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const sku of FQA_SKU_LIST) {
    const row = page.getByTestId(`inventory-row-${sku}`);
    if (await row.isVisible()) out.push(sku);
  }
  return out;
}

export async function expectFqaSkusSorted(page: Page, expected: readonly string[]) {
  const got = (await visibleFqaSkus(page)).slice().sort();
  expect(got.sort()).toEqual(expected.slice().sort());
}

export function skusFromOperationalExportCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((l) => {
    const t = l.replace(/"/g, "").trim();
    return t.startsWith("SKU") && t.includes("Name") && t.includes("Location");
  });
  if (headerIdx < 0) return [];
  const skus: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^"([^"]+)"/);
    if (m) skus.push(m[1]);
  }
  return skus;
}
