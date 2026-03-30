import { Buffer } from "buffer";
import Excel from "exceljs";

export async function workbookToBuffer(workbook: Excel.Workbook): Promise<Buffer> {
  const excelBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(excelBuffer);
}

/** Prepend UTF-8 BOM + sep=, and use CRLF so Excel opens CSV as a clean table */
export function csvBufferForExcel(buffer: Buffer): Buffer {
  const content = buffer.toString("utf8").replace(/\r?\n/g, "\r\n");
  return Buffer.from("\uFEFFsep=,\r\n" + content, "utf8");
}
