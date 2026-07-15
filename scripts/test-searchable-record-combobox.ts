import assert from "node:assert/strict";
import { filterSearchableOptions } from "../client/src/components/searchable-record-combobox";

const options = Array.from({ length: 75 }, (_, index) => ({
  value: String(index + 1),
  label: `Inventory item ${index + 1}`,
  keywords: index === 72 ? "needle-sku" : `SKU-${index + 1}`,
}));

assert.equal(filterSearchableOptions(options, "").length, 20, "Unfiltered pickers must render at most 20 suggestions");
assert.deepEqual(
  filterSearchableOptions(options, "needle-sku").map((option) => option.value),
  ["73"],
  "Search must find records outside the first suggestion page",
);
assert.equal(filterSearchableOptions(options, "INVENTORY ITEM 5")[0]?.value, "5", "Search must be case-insensitive");

console.log("Searchable record combobox tests passed.");
