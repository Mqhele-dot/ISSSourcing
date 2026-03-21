/**
 * Download a 2D string array as a CSV file in the browser.
 * Uses Excel-friendly `sep=,` header line (RFC 4180-style quoted cells).
 */
export function downloadCsv(filename: string, rows: string[][]): void {
  const escaped = rows.map((row) =>
    row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
  );
  const csv = "sep=,\n" + escaped.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
