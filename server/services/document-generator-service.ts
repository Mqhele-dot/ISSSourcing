// Document generator service
import type { PDFImage, PDFPage, PDFFont } from 'pdf-lib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Excel from 'exceljs';
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  Footer,
  Header,
  Packer,
  PageOrientation,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type {
  ActivityLog,
  InventoryItem,
  ReportType,
  ReportFormat,
  User,
  Supplier,
  Warehouse,
} from "@shared/schema";
import {
  getReportColumnsFromConfig,
  getReportExportEntry,
  type ReportPdfLayout,
} from "./export-config";
import { format } from 'date-fns';
import { REPORTING_CURRENCY_FALLBACK_CODE } from "../lib/org-reporting-money";

// ——— Shared PDF layout (matches app style: InvTrack, accent blue, clean table) ———
const PDF_LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  margin: 50,
  headerTop: 50,
  /** Vertical space from top of page through header rule + padding (see drawPdfReportHeader). */
  headerBlockHeight: 132,
  headerHeight: 72,
  footerHeight: 28,
  tableRowHeight: 18,
  tableHeaderHeight: 22,
  fontSize: 10,
  fontHeaderSize: 11,
  titleSize: 18,
  // App accent (HSL 221 83% 53%) → RGB
  accent: rgb(0.29, 0.45, 0.95),
  accentMuted: rgb(0.85, 0.89, 0.98),
  text: rgb(0.11, 0.18, 0.25),
  muted: rgb(0.45, 0.48, 0.55),
  border: rgb(0.85, 0.87, 0.9),
} as const;

const APP_NAME = 'InvTrack';

/** Set for the duration of `generateDocument` so all PDF footers can show org legal line without threading through every helper. */
let activePdfOrganizationFooter: string | undefined;

/** Org display name from `organization_settings.display_name` for PDF header/footer branding. */
let activePdfBrandName: string = APP_NAME;

/** Raw PNG/JPEG bytes from `organization_settings.logo_url` for the PDF header (set per `generateDocument`). */
let activePdfLogoBytes: Uint8Array | undefined;

/** ISO 4217 code for PDF/CSV monetary formatting (set per `generateDocument` or dedicated PDF entrypoints). */
let activeReportingCurrencyCode = REPORTING_CURRENCY_FALLBACK_CODE;

/** Embedded once per PDF document after `embedPdfLogoIfNeeded`. */
let activePdfLogoImage: PDFImage | null = null;

async function embedPdfLogoIfNeeded(pdfDoc: PDFDocument): Promise<void> {
  activePdfLogoImage = null;
  if (!activePdfLogoBytes?.length) return;
  try {
    activePdfLogoImage = await pdfDoc.embedPng(activePdfLogoBytes);
  } catch {
    try {
      activePdfLogoImage = await pdfDoc.embedJpg(activePdfLogoBytes);
    } catch {
      activePdfLogoImage = null;
    }
  }
}

/** Map common Unicode punctuation to ASCII so WinAnsi PDF text stays readable (avoids stray "?"). */
function normalizePdfUnicode(input: string): string {
  return String(input)
    .replace(/\uFEFF/g, "")
    .replace(/\uFF1A/g, ":")
    .replace(/\uFF0B/g, "+")
    .replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2015|\u2212|\uFE58|\uFE63|\uFF0D/g, "-")
    .replace(/\u00B7|\u2022|\u2023/g, " | ")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u00AD/g, "");
}

/**
 * Standard 14 fonts (Helvetica) use WinAnsi; unsupported glyphs can break pdf-lib drawText.
 */
function sanitizePdfText(input: string): string {
  return normalizePdfUnicode(String(input))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function normalizeReportingCurrencyCode(raw?: string | null): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) return REPORTING_CURRENCY_FALLBACK_CODE;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: s }).format(0);
    return s;
  } catch {
    return REPORTING_CURRENCY_FALLBACK_CODE;
  }
}

/**
 * PDF-safe monetary string (currency code + amount via Intl, then sanitized for WinAnsi fonts).
 */
function formatReportingAmountPdf(n: number, currencyCode?: string): string {
  const code = normalizeReportingCurrencyCode(currencyCode ?? activeReportingCurrencyCode);
  try {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
    return sanitizePdfText(formatted);
  } catch {
    return sanitizePdfText(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: REPORTING_CURRENCY_FALLBACK_CODE,
        currencyDisplay: "code",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n),
    );
  }
}

function formatPdfMoney(n: number): string {
  return formatReportingAmountPdf(n, activeReportingCurrencyCode);
}

function applyPdfMetadata(pdfDoc: PDFDocument, title: string): void {
  const safe = sanitizePdfText(title).slice(0, 240);
  pdfDoc.setTitle(safe || "InvTrack report");
  pdfDoc.setSubject(safe || "InvTrack export");
  pdfDoc.setCreator(APP_NAME);
  pdfDoc.setProducer(`${APP_NAME} document service`);
  const now = new Date();
  pdfDoc.setCreationDate(now);
  pdfDoc.setModificationDate(now);
}

function formatPdfCell(value: unknown, opts?: { currency?: boolean; date?: boolean }): string {
  let out: string;
  if (value === null || value === undefined) out = '—';
  else if (opts?.currency) {
    const n = Number(value);
    if (Number.isNaN(n)) out = '—';
    else out = formatPdfMoney(n);
  } else if (opts?.date) {
    if (value instanceof Date) out = format(value, 'MMM d, yyyy');
    else {
      const d = new Date(value as string | number);
      if (!Number.isNaN(d.getTime())) out = format(d, 'MMM d, yyyy');
      else out = String(value);
    }
  } else if (typeof value === 'number' && Number.isNaN(value)) out = '—';
  else out = String(value);
  return sanitizePdfText(out);
}

function truncateForPdf(s: string, maxLen: number): string {
  const base = sanitizePdfText(s);
  if (base.length <= maxLen) return base;
  return base.slice(0, maxLen - 3) + '...';
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatExportValue(value: unknown, key?: string, forHumanReadableExport = false): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const valueFormat = key ? PDF_COLUMN_FORMAT[key] : undefined;
  if (valueFormat === "date") {
    const d = new Date(value as string | number | Date);
    if (!Number.isNaN(d.getTime())) {
      return format(d, "yyyy-MM-dd");
    }
  }
  if (valueFormat === "currency") {
    const n = Number(value);
    if (!Number.isNaN(n)) {
      if (forHumanReadableExport) {
        return `${n.toFixed(2)} ${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}`;
      }
      return n.toFixed(2);
    }
  }

  if (value instanceof Date) return format(value, "yyyy-MM-dd");
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

function buildGenericSummaryMetrics(data: any[], columns: { header: string; key: string; width: number }[]): Array<{ label: string; value: string }> {
  const currencyColumns = columns.filter((col) => PDF_COLUMN_FORMAT[col.key] === "currency").map((col) => col.key);
  const currencyTotal = data.reduce((sum, item) => {
    for (const key of currencyColumns) {
      const n = Number(item?.[key] ?? 0);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }, 0);

  return [
    { label: "Records", value: String(data.length) },
    { label: "Columns", value: String(columns.length) },
    { label: "Updated", value: format(new Date(), "yyyy-MM-dd") },
    { label: "Monetary Sum", value: formatPdfMoney(currencyTotal) },
  ];
}

/** First body `y` below the header rule (PDF coords, origin bottom-left). */
function getPdfBodyStartY(page: PDFPage): number {
  const { height } = page.getSize();
  return height - PDF_LAYOUT.headerBlockHeight;
}

function drawPdfReportHeader(
  page: PDFPage,
  title: string,
  font: PDFFont,
  boldFont: PDFFont
): void {
  const { width, height } = page.getSize();
  const m = PDF_LAYOUT.margin;
  const y = height - PDF_LAYOUT.headerTop;
  const markSize = 18;
  let textX = m + markSize + 10;

  if (activePdfLogoImage) {
    const maxH = 36;
    const scale = maxH / activePdfLogoImage.height;
    const imgW = activePdfLogoImage.width * scale;
    const imgH = maxH;
    page.drawImage(activePdfLogoImage, {
      x: m,
      y: y - imgH + 2,
      width: imgW,
      height: imgH,
    });
    textX = m + imgW + 10;
  } else {
    page.drawRectangle({
      x: m,
      y: y - markSize + 2,
      width: markSize,
      height: markSize,
      color: PDF_LAYOUT.accent,
    });
    page.drawText("IT", {
      x: m + 3,
      y: y - markSize + 6,
      size: 9,
      font: boldFont,
      color: rgb(1, 1, 1),
    });
  }

  const safeTitle = sanitizePdfText(title);
  page.drawText(sanitizePdfText(activePdfBrandName), {
    x: textX,
    y,
    size: 12,
    font: boldFont,
    color: PDF_LAYOUT.accent,
  });
  page.drawText(safeTitle, {
    x: textX,
    y: y - 22,
    size: PDF_LAYOUT.titleSize,
    font: boldFont,
    color: PDF_LAYOUT.text,
  });
  const dateStr = sanitizePdfText(format(new Date(), "MMMM d, yyyy"));
  page.drawText(`Generated on ${dateStr}`, {
    x: textX,
    y: y - 44,
    size: PDF_LAYOUT.fontHeaderSize,
    font,
    color: PDF_LAYOUT.muted,
  });
  // Line under header
  page.drawLine({
    start: { x: m, y: y - 54 },
    end: { x: width - m, y: y - 54 },
    thickness: 0.5,
    color: PDF_LAYOUT.border,
  });
}

function drawPdfReportFooter(
  page: PDFPage,
  pageNum: number,
  font: PDFFont,
  totalPages?: number,
): void {
  const { width, height } = page.getSize();
  const m = PDF_LAYOUT.margin;
  const y = PDF_LAYOUT.footerHeight;
  const organizationFooter = activePdfOrganizationFooter;

  // Clear footer band so we can safely redraw after pagination is finalized.
  page.drawRectangle({
    x: m - 2,
    y: y - 2,
    width: width - (m - 2) * 2,
    height: organizationFooter ? 28 : 14,
    color: rgb(1, 1, 1),
  });

  page.drawText(sanitizePdfText(`Generated by ${activePdfBrandName}`), {
    x: m,
    y,
    size: 9,
    font,
    color: PDF_LAYOUT.muted,
  });
  const pageLabel = totalPages && totalPages > 0 ? `Page ${pageNum} of ${totalPages}` : `Page ${pageNum}`;
  const pageLabelWidth = font.widthOfTextAtSize(pageLabel, 9);
  page.drawText(pageLabel, {
    x: width - m - pageLabelWidth,
    y,
    size: 9,
    font,
    color: PDF_LAYOUT.muted,
  });
  if (organizationFooter?.trim()) {
    const line = sanitizePdfText(organizationFooter.trim()).slice(0, 120);
    page.drawText(line, {
      x: m,
      y: y - 12,
      size: 8,
      font,
      color: PDF_LAYOUT.muted,
    });
  }
}

function drawSummarySection(
  page: PDFPage,
  title: string,
  metrics: Array<{ label: string; value: string }>,
  font: PDFFont,
  boldFont: PDFFont,
): void {
  const m = PDF_LAYOUT.margin;
  const { height: pageHeight } = page.getSize();
  const top = pageHeight - PDF_LAYOUT.headerHeight - 8;
  page.drawText("Summary", {
    x: m,
    y: top,
    size: 12,
    font: boldFont,
    color: PDF_LAYOUT.text,
  });
  page.drawText(sanitizePdfText(title), {
    x: m + 72,
    y: top,
    size: 10,
    font,
    color: PDF_LAYOUT.muted,
  });
  const cardY = top - 30;
  const totalWidth = page.getSize().width - m * 2;
  const gap = 8;
  const cardWidth = Math.max(80, Math.floor((totalWidth - gap * (metrics.length - 1)) / metrics.length));
  metrics.forEach((metric, index) => {
    const x = m + index * (cardWidth + gap);
    page.drawRectangle({
      x,
      y: cardY - 4,
      width: cardWidth,
      height: 30,
      color: rgb(0.98, 0.99, 1),
      borderColor: PDF_LAYOUT.border,
      borderWidth: 0.5,
    });
    page.drawText(sanitizePdfText(metric.label), {
      x: x + 6,
      y: cardY + 14,
      size: 7,
      font,
      color: PDF_LAYOUT.muted,
    });
    page.drawText(sanitizePdfText(metric.value), {
      x: x + 6,
      y: cardY + 3,
      size: 10,
      font: boldFont,
      color: PDF_LAYOUT.text,
    });
  });
}

/** Draw a bordered table; may add new pages. Uses reportTitle for continuation page headers. */
function drawBorderedTable(
  pdfDoc: PDFDocument,
  pages: PDFPage[],
  reportTitle: string,
  headers: string[],
  colWidths: number[],
  rows: string[][],
  font: PDFFont,
  boldFont: PDFFont,
  tableTopOverride?: number,
): void {
  const m = PDF_LAYOUT.margin;
  const tableTop = tableTopOverride ?? (PDF_LAYOUT.pageHeight - PDF_LAYOUT.headerHeight - PDF_LAYOUT.margin);
  const bottomY = PDF_LAYOUT.margin + PDF_LAYOUT.footerHeight + PDF_LAYOUT.tableRowHeight;
  const rowH = PDF_LAYOUT.tableRowHeight;
  const headerH = PDF_LAYOUT.tableHeaderHeight;
  let pageIndex = 0;
  let y = tableTop - headerH;

  function currentPage(): PDFPage {
    return pages[pageIndex];
  }

  function drawHorizontalLine(page: PDFPage, yLine: number): void {
    page.drawLine({
      start: { x: m, y: yLine },
      end: { x: m + colWidths.reduce((a, b) => a + b, 0), y: yLine },
      thickness: 0.5,
      color: PDF_LAYOUT.border,
    });
  }

  function drawVerticalLines(page: PDFPage, yTop: number, yBottom: number): void {
    let x = m;
    for (let i = 0; i <= colWidths.length; i++) {
      page.drawLine({
        start: { x, y: yTop },
        end: { x, y: yBottom },
        thickness: 0.5,
        color: PDF_LAYOUT.border,
      });
      if (i < colWidths.length) x += colWidths[i];
    }
  }

  // Header row (filled background + text)
  const headerY = tableTop - headerH * 0.5;
  currentPage().drawRectangle({
    x: m,
    y: tableTop - headerH,
    width: colWidths.reduce((a, b) => a + b, 0),
    height: headerH,
    color: PDF_LAYOUT.accentMuted,
  });
  let xPos = m + 4;
  headers.forEach((h, i) => {
    currentPage().drawText(truncateForPdf(h, 24), {
      x: xPos,
      y: headerY,
      size: PDF_LAYOUT.fontHeaderSize,
      font: boldFont,
      color: PDF_LAYOUT.text,
    });
    xPos += colWidths[i];
  });
  drawHorizontalLine(currentPage(), tableTop - headerH);
  drawVerticalLines(currentPage(), tableTop - headerH, tableTop);
  y = tableTop - headerH - rowH;

  const firstSize = pages[0]?.getSize();
  const pageW = firstSize?.width ?? PDF_LAYOUT.pageWidth;
  const pageH = firstSize?.height ?? PDF_LAYOUT.pageHeight;

  for (let r = 0; r < rows.length; r++) {
    if (y < bottomY) {
      pageIndex++;
      if (pageIndex >= pages.length) {
        const newPage = pdfDoc.addPage([pageW, pageH]);
        pages.push(newPage);
        drawPdfReportHeader(newPage, reportTitle, font, boldFont);
        drawPdfReportFooter(newPage, pages.length, font);
        y = tableTop - headerH;
        currentPage().drawRectangle({
          x: m,
          y: y,
          width: colWidths.reduce((a, b) => a + b, 0),
          height: headerH,
          color: PDF_LAYOUT.accentMuted,
        });
        xPos = m + 4;
        headers.forEach((h, i) => {
          currentPage().drawText(truncateForPdf(h, 24), {
            x: xPos,
            y: y + headerH * 0.5 - 4,
            size: PDF_LAYOUT.fontHeaderSize,
            font: boldFont,
            color: PDF_LAYOUT.text,
          });
          xPos += colWidths[i];
        });
        drawHorizontalLine(currentPage(), y);
        drawVerticalLines(currentPage(), y, y + headerH);
        y -= rowH;
      }
    }
    const row = rows[r];
    xPos = m + 4;
    row.forEach((cell, i) => {
      const maxChars = Math.max(8, Math.floor((colWidths[i] ?? 40) / 4));
      currentPage().drawText(truncateForPdf(cell, maxChars), {
        x: xPos,
        y: y + rowH * 0.5 - 4,
        size: PDF_LAYOUT.fontSize,
        font,
        color: PDF_LAYOUT.text,
      });
      xPos += colWidths[i];
    });
    drawHorizontalLine(currentPage(), y);
    if (r === 0 || y + rowH >= tableTop - headerH) {
      drawVerticalLines(currentPage(), y, y + rowH);
    }
    y -= rowH;
  }
  drawVerticalLines(currentPage(), y + rowH, tableTop);
}

function wrapPdfCellLines(text: string, font: PDFFont, fontSize: number, maxInnerWidth: number): string[] {
  const base = sanitizePdfText(text);
  if (!base.trim()) return [""];
  const words = base.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  const pushCurrent = () => {
    if (current) lines.push(current);
    current = "";
  };
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxInnerWidth) {
      current = candidate;
      continue;
    }
    if (current) pushCurrent();
    if (font.widthOfTextAtSize(w, fontSize) <= maxInnerWidth) {
      current = w;
      continue;
    }
    let chunk = "";
    for (const ch of w) {
      const next = chunk + ch;
      if (font.widthOfTextAtSize(next, fontSize) <= maxInnerWidth) {
        chunk = next;
      } else {
        if (chunk) lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Per-PO continuation page: boilerplate terms + dual signature lines. */
function appendPurchaseOrderTermsPage(
  pdfDoc: PDFDocument,
  allPages: PDFPage[],
  reportTitle: string,
  pw: number,
  ph: number,
  font: PDFFont,
  boldFont: PDFFont,
): void {
  const page = pdfDoc.addPage([pw, ph]);
  allPages.push(page);
  drawPdfReportHeader(page, reportTitle, font, boldFont);
  const { width } = page.getSize();
  /** Match first-page body start so terms never overlap the header band (was using headerHeight only). */
  let y = getPdfBodyStartY(page) - 8;
  const maxW = width - 2 * PDF_LAYOUT.margin;

  page.drawText(sanitizePdfText("Terms & conditions"), {
    x: PDF_LAYOUT.margin,
    y,
    size: 12,
    font: boldFont,
    color: PDF_LAYOUT.text,
  });
  y -= 16;
  page.drawText(sanitizePdfText("Use wet ink or your approved e-signature process. This page is the formal acceptance record for the order above."), {
    x: PDF_LAYOUT.margin,
    y,
    size: 9,
    font,
    color: PDF_LAYOUT.muted,
  });
  y -= 22;

  const termParas = [
    "1. Payment is due per agreed payment terms. Title and risk pass as stated on this order or per the referenced Incoterm / contract.",
    "2. Deliveries are subject to inspection; quantity or quality disputes must be notified in writing within five (5) business days of receipt.",
    "3. This purchase order is issued under the buyer's standard purchasing policies and any executed agreement that applies to this supplier.",
  ];
  for (const para of termParas) {
    for (const line of wrapPdfCellLines(para, font, PDF_LAYOUT.fontSize, maxW)) {
      page.drawText(line, {
        x: PDF_LAYOUT.margin,
        y,
        size: PDF_LAYOUT.fontSize,
        font,
        color: PDF_LAYOUT.text,
      });
      y -= 12;
    }
    y -= 4;
  }

  y -= 8;
  page.drawText(sanitizePdfText("Authorized acceptance"), {
    x: PDF_LAYOUT.margin,
    y,
    size: 11,
    font: boldFont,
    color: PDF_LAYOUT.accent,
  });
  y -= 22;
  const midX = PDF_LAYOUT.margin + maxW * 0.5;
  page.drawLine({
    start: { x: PDF_LAYOUT.margin, y },
    end: { x: midX - 14, y },
    thickness: 0.5,
    color: PDF_LAYOUT.border,
  });
  page.drawLine({
    start: { x: midX + 14, y },
    end: { x: PDF_LAYOUT.margin + maxW, y },
    thickness: 0.5,
    color: PDF_LAYOUT.border,
  });
  y -= 12;
  page.drawText("Buyer / authorized signatory", {
    x: PDF_LAYOUT.margin,
    y,
    size: 9,
    font,
    color: PDF_LAYOUT.muted,
  });
  page.drawText("Supplier / authorized signatory", {
    x: midX + 14,
    y,
    size: 9,
    font,
    color: PDF_LAYOUT.muted,
  });
}

/** Bordered table with wrap-first cells and dynamic row height (top-aligned text). */
function drawBorderedTableWrapped(
  pdfDoc: PDFDocument,
  pages: PDFPage[],
  reportTitle: string,
  headers: string[],
  colWidths: number[],
  rows: string[][],
  font: PDFFont,
  boldFont: PDFFont,
  tableTop: number,
): void {
  const m = PDF_LAYOUT.margin;
  const lineSpacing = 11;
  const bottomY = PDF_LAYOUT.margin + PDF_LAYOUT.footerHeight + lineSpacing;
  const headerH = PDF_LAYOUT.tableHeaderHeight;
  let pageIndex = 0;
  let y = tableTop - headerH;

  const firstSize = pages[0]?.getSize();
  const pageW = firstSize?.width ?? PDF_LAYOUT.pageWidth;
  const pageH = firstSize?.height ?? PDF_LAYOUT.pageHeight;

  function currentPage(): PDFPage {
    return pages[pageIndex];
  }

  function drawHorizontalLine(page: PDFPage, yLine: number): void {
    page.drawLine({
      start: { x: m, y: yLine },
      end: { x: m + colWidths.reduce((a, b) => a + b, 0), y: yLine },
      thickness: 0.5,
      color: PDF_LAYOUT.border,
    });
  }

  function drawVerticalLines(page: PDFPage, yTop: number, yBottom: number): void {
    let x = m;
    for (let i = 0; i <= colWidths.length; i++) {
      page.drawLine({
        start: { x, y: yTop },
        end: { x, y: yBottom },
        thickness: 0.5,
        color: PDF_LAYOUT.border,
      });
      if (i < colWidths.length) x += colWidths[i];
    }
  }

  function drawHeaderBand(page: PDFPage, yTop: number): void {
    const headerY = yTop - headerH * 0.5;
    page.drawRectangle({
      x: m,
      y: yTop - headerH,
      width: colWidths.reduce((a, b) => a + b, 0),
      height: headerH,
      color: PDF_LAYOUT.accentMuted,
    });
    let xPos = m + 4;
    headers.forEach((h, i) => {
      page.drawText(truncateForPdf(h, 28), {
        x: xPos,
        y: headerY,
        size: PDF_LAYOUT.fontHeaderSize,
        font: boldFont,
        color: PDF_LAYOUT.text,
      });
      xPos += colWidths[i];
    });
    drawHorizontalLine(page, yTop - headerH);
    drawVerticalLines(page, yTop - headerH, yTop);
  }

  drawHeaderBand(currentPage(), tableTop);
  y = tableTop - headerH;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cellLineBlocks = row.map((cell, i) =>
      wrapPdfCellLines(cell, font, PDF_LAYOUT.fontSize, Math.max(16, (colWidths[i] ?? 40) - 8)),
    );
    const maxLines = Math.max(1, ...cellLineBlocks.map((b) => b.length));
    const rowH = maxLines * lineSpacing + 8;

    if (y - rowH < bottomY) {
      pageIndex++;
      if (pageIndex >= pages.length) {
        const newPage = pdfDoc.addPage([pageW, pageH]);
        pages.push(newPage);
        drawPdfReportHeader(newPage, reportTitle, font, boldFont);
        drawPdfReportFooter(newPage, pages.length, font);
        const contTableTop = pageH - PDF_LAYOUT.headerBlockHeight;
        drawHeaderBand(newPage, contTableTop);
        y = contTableTop - headerH;
      }
    }

    const rowBottom = y - rowH;
    let xPos = m + 4;
    const useBoldRow = row.some((c) => String(c).trim() === "Total");
    const cellFont = useBoldRow ? boldFont : font;
    row.forEach((_cell, i) => {
      const lines = cellLineBlocks[i] ?? [""];
      let lineBaseline = y - 6 - PDF_LAYOUT.fontSize;
      for (const ln of lines) {
        currentPage().drawText(sanitizePdfText(ln), {
          x: xPos,
          y: lineBaseline,
          size: PDF_LAYOUT.fontSize,
          font: cellFont,
          color: PDF_LAYOUT.text,
        });
        lineBaseline -= lineSpacing;
      }
      xPos += colWidths[i] ?? 0;
    });

    drawHorizontalLine(currentPage(), y);
    drawHorizontalLine(currentPage(), rowBottom);
    drawVerticalLines(currentPage(), rowBottom, y);
    y = rowBottom;
  }
  drawVerticalLines(currentPage(), y, tableTop);
}

function drawLabelValueColumn(
  page: PDFPage,
  boldFont: PDFFont,
  font: PDFFont,
  x: number,
  startY: number,
  label: string,
  value: string,
  maxInnerWidth: number,
): number {
  let y = startY;
  page.drawText(sanitizePdfText(label), {
    x,
    y,
    size: 8,
    font: boldFont,
    color: PDF_LAYOUT.muted,
  });
  y -= 11;
  const lines = wrapPdfCellLines(value || "—", font, PDF_LAYOUT.fontSize, maxInnerWidth);
  for (const ln of lines) {
    page.drawText(ln, {
      x,
      y,
      size: PDF_LAYOUT.fontSize,
      font,
      color: PDF_LAYOUT.text,
    });
    y -= 11;
  }
  return y - 6;
}

/** Inventory item with optional category name for PDF export */
export type InventoryItemForPdf = InventoryItem & { categoryName?: string };

/**
 * Generate a PDF document from inventory data (shared InvTrack layout, clean data).
 * @param template 'standard' (default) or 'compact' for tighter layout
 */
export async function generateInventoryPdf(
  items: InventoryItemForPdf[],
  title: string,
  _columns?: any[],
  template: PdfTemplate = 'standard'
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([PDF_LAYOUT.pageWidth, PDF_LAYOUT.pageHeight]);
  const pages: PDFPage[] = [page];
  drawPdfReportHeader(page, title, font, boldFont);
  drawPdfReportFooter(page, 1, font);

  const headers = ['SKU', 'Name', 'Category', 'Quantity', 'Price', 'Status'];
  const colWidths = [78, 148, 88, 52, 72, 82];

  const rows = items.map((item) => {
    const qty = Number(item.quantity);
    const threshold = item.lowStockThreshold != null ? Number(item.lowStockThreshold) : null;
    const status =
      !Number.isFinite(qty) || qty <= 0
        ? 'Out of Stock'
        : threshold != null && Number.isFinite(threshold) && qty <= threshold
          ? 'Low Stock'
          : 'In Stock';
    return [
      formatPdfCell(item.sku),
      formatPdfCell(item.name),
      formatPdfCell((item as InventoryItemForPdf).categoryName ?? item.categoryId),
      formatPdfCell(item.quantity),
      formatPdfCell(item.price, { currency: true }),
      status,
    ];
  });

  const lowStockCount = items.filter((item) => {
    const qty = Number(item.quantity ?? 0);
    const threshold = Number(item.lowStockThreshold ?? 0);
    return Number.isFinite(qty) && Number.isFinite(threshold) && qty <= threshold;
  }).length;
  drawSummarySection(
    page,
    "Inventory health snapshot",
    [
      { label: "Total SKUs", value: String(items.length) },
      { label: "Low stock", value: String(lowStockCount) },
      {
        label: "Inventory value",
        value: formatPdfMoney(
          items.reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0), 0),
        ),
      },
    ],
    font,
    boldFont,
  );

  const tableTop = PDF_LAYOUT.pageHeight - PDF_LAYOUT.headerHeight - PDF_LAYOUT.margin - 56;
  drawBorderedTable(pdfDoc, pages, title, headers, colWidths, rows, font, boldFont, tableTop);
  const totalPages = pages.length;
  pages.forEach((p, index) => drawPdfReportFooter(p, index + 1, font, totalPages));

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/** UTF-8 BOM so Excel recognizes encoding */
const CSV_BOM = '\uFEFF';
/** CRLF for Excel-friendly line endings */
const CSV_EOL = '\r\n';

/**
 * Generate a CSV document from inventory data.
 * Uses UTF-8 BOM + sep=, + CRLF so Excel opens as a clean table.
 */
export async function generateInventoryCsv(items: InventoryItem[], title: string, _columns?: any[]): Promise<Buffer> {
  const lines = [
    CSV_BOM + 'sep=,',
    `"${title.replace(/"/g, '""')}"`,
    `"Generated","${format(new Date(), "yyyy-MM-dd HH:mm")}"`,
    `"Reporting currency (ISO 4217)","${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}"`,
    "",
    ['SKU', 'Name', 'Description', 'Category', 'Quantity', 'Price', 'Cost', 'Status', 'Low Stock Threshold'].join(','),
  ];
  items.forEach(item => {
    const status = item.quantity <= 0 ? 'Out of Stock' : 
                  (item.lowStockThreshold && item.quantity <= item.lowStockThreshold) ? 'Low Stock' : 
                  'In Stock';
    lines.push([
      item.sku || '',
      item.name,
      item.description || '',
      item.categoryId || '',
      item.quantity,
      formatExportValue(item.price, "price", true),
      formatExportValue(item.cost, "cost", true),
      status,
      item.lowStockThreshold || ''
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','));
  });
  return Buffer.from(lines.join(CSV_EOL), 'utf8');
}

export type OperationalInventoryCsvRow = {
  sku: string;
  name: string;
  location: string | null;
  onHand: number;
  allocated: number;
  available: number;
  lowStockThreshold: number;
  updatedAt?: Date | string | null;
};

/**
 * CSV aligned with GET /api/inventory operational list (locations, allocations, filters).
 */
export function generateOperationalInventoryCsvFromRows(
  items: OperationalInventoryCsvRow[],
  title: string,
): Buffer {
  const lines = [
    CSV_BOM + 'sep=,',
    `"${title.replace(/"/g, '""')}"`,
    `"Generated","${format(new Date(), "yyyy-MM-dd HH:mm")}"`,
    `"Reporting currency (ISO 4217)","${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}"`,
    "",
    ["SKU", "Name", "Location", "On hand", "Allocated", "Available", "Low stock threshold", "Updated at"].join(","),
  ];
  for (const item of items) {
    const updated =
      item.updatedAt == null
        ? ""
        : typeof item.updatedAt === "string"
          ? item.updatedAt
          : format(item.updatedAt, "yyyy-MM-dd HH:mm:ss");
    lines.push(
      [
        item.sku,
        item.name,
        item.location ?? "",
        item.onHand,
        item.allocated,
        item.available,
        item.lowStockThreshold,
        updated,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  return Buffer.from(lines.join(CSV_EOL), "utf8");
}

/**
 * Generate an Excel document from inventory data
 */
export async function generateInventoryExcel(items: InventoryItem[], title: string, _columns?: any[]): Promise<Buffer> {
  // Create a new workbook and add a worksheet
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet('Inventory');
  
  // Set up the columns
  worksheet.columns = [
    { header: 'SKU', key: 'sku', width: 15 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Price', key: 'price', width: 12 },
    { header: 'Cost', key: 'cost', width: 12 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Low Stock Threshold', key: 'lowStockThreshold', width: 20 },
    { header: 'Last Updated', key: 'lastUpdated', width: 18 }
  ];
  
  // Add title and metadata section before headers
  worksheet.insertRow(1, [title]);
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.mergeCells('A1:J1');
  worksheet.insertRow(2, [`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`]);
  worksheet.mergeCells("A2:J2");
  worksheet.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };
  worksheet.insertRow(3, [
    `Reporting currency (ISO 4217): ${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}`,
  ]);
  worksheet.mergeCells("A3:J3");
  worksheet.getCell("A3").font = { italic: true, color: { argb: "FF64748B" } };

  // Header styling
  const headerRow = worksheet.getRow(4);
  headerRow.font = { bold: true, color: { argb: "FF0F172A" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;
  worksheet.views = [{ state: "frozen", ySplit: 4, activeCell: "A5" }];
  
  // Add data
  items.forEach(item => {
    const status = item.quantity <= 0 ? 'Out of Stock' : 
                  (item.lowStockThreshold && item.quantity <= item.lowStockThreshold) ? 'Low Stock' : 
                  'In Stock';
    
    worksheet.addRow({
      sku: item.sku || '',
      name: item.name,
      description: item.description || '',
      category: item.categoryId || '',
      quantity: item.quantity,
      price: Number(formatExportValue(item.price, "price")),
      cost: item.cost == null ? "" : Number(formatExportValue(item.cost, "cost")),
      status: status,
      lowStockThreshold: item.lowStockThreshold || '',
      lastUpdated: item.updatedAt ? format(new Date(item.updatedAt), 'yyyy-MM-dd HH:mm') : ''
    });
  });
  
  // Apply professional table formatting and alignment
  for (let rowNumber = 5; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    row.getCell(5).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(6).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(7).alignment = { vertical: "middle", horizontal: "right" };
  }

  worksheet.getColumn(6).numFmt = '#,##0.00';
  worksheet.getColumn(7).numFmt = '#,##0.00';
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** Hint for formatting a column in generic PDF */
const PDF_COLUMN_FORMAT: Record<string, 'currency' | 'date'> = {
  price: 'currency',
  cost: 'currency',
  totalAmount: 'currency',
  unitPrice: 'currency',
  totalPrice: 'currency',
  orderDate: 'date',
  expectedDeliveryDate: 'date',
  requiredDate: 'date',
  approvalDate: 'date',
  createdAt: 'date',
  updatedAt: 'date',
  timestamp: 'date',
  lastLogin: 'date',
};

export type GenericPdfOptions = {
  orientation?: "portrait" | "landscape";
  /** Shown under summary cards (export time, filters, request id, …) */
  metadataLines?: string[];
  /** Prefer wrap-first cells instead of truncation */
  useWrappedTable?: boolean;
};

function drawPdfExtraMetadataLines(page: PDFPage, font: PDFFont, lines: string[], startY: number): number {
  let y = startY;
  for (const line of lines) {
    if (!line.trim()) continue;
    page.drawText(sanitizePdfText(line).slice(0, 200), {
      x: PDF_LAYOUT.margin,
      y,
      size: 8,
      font,
      color: PDF_LAYOUT.muted,
    });
    y -= 12;
  }
  return y;
}

/**
 * Generic PDF generator for any data array (shared InvTrack layout, clean data)
 */
export async function generateGenericPdf(
  data: any[],
  title: string,
  columns: { header: string; key: string; width: number }[],
  options?: GenericPdfOptions,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const landscape = options?.orientation === "landscape";
  const pw = landscape ? PDF_LAYOUT.pageHeight : PDF_LAYOUT.pageWidth;
  const ph = landscape ? PDF_LAYOUT.pageWidth : PDF_LAYOUT.pageHeight;

  const page = pdfDoc.addPage([pw, ph]);
  const pages: PDFPage[] = [page];
  drawPdfReportHeader(page, title, font, boldFont);
  drawPdfReportFooter(page, 1, font);
  drawSummarySection(
    page,
    "Report metadata",
    [
      { label: "Records", value: String(data.length) },
      { label: "Columns", value: String(columns.length) },
      { label: "Source", value: APP_NAME },
    ],
    font,
    boldFont,
  );

  const { height } = page.getSize();
  let metaBottom = height - PDF_LAYOUT.headerHeight - PDF_LAYOUT.margin - 62;
  if (options?.metadataLines?.length) {
    metaBottom = drawPdfExtraMetadataLines(page, font, options.metadataLines, metaBottom);
  }

  const headers = columns.map((c) => c.header);
  let colWidths = columns.map((c) => c.width);
  const maxTableWidth = pw - 2 * PDF_LAYOUT.margin;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  if (totalWidth > maxTableWidth) {
    const scale = maxTableWidth / totalWidth;
    colWidths = colWidths.map((w) => Math.max(20, Math.round(w * scale)));
  }

  const rows = data.map((item) =>
    columns.map((col) => {
      const raw = item[col.key];
      const fmt = PDF_COLUMN_FORMAT[col.key];
      return formatPdfCell(raw, fmt === "currency" ? { currency: true } : fmt === "date" ? { date: true } : undefined);
    }),
  );

  const tableTop = metaBottom - 8;
  if (options?.useWrappedTable) {
    drawBorderedTableWrapped(pdfDoc, pages, title, headers, colWidths, rows, font, boldFont, tableTop);
  } else {
    drawBorderedTable(pdfDoc, pages, title, headers, colWidths, rows, font, boldFont, tableTop);
  }
  const totalPages = pages.length;
  pages.forEach((p, index) => drawPdfReportFooter(p, index + 1, font, totalPages));

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function userDisplayName(u?: User | null): string {
  if (!u) return "—";
  const n = (u.fullName || u.username || "").trim();
  return n || "—";
}

/** One or more purchase orders with `supplier` and `items` (from getPurchaseOrderWithDetails). */
export async function generatePurchaseOrdersDocumentPdf(
  orders: any[],
  title: string,
  metadataLines: string[] = [],
  pdfOptions?: { reportingCurrencyCode?: string },
): Promise<Buffer> {
  const prevReporting = activeReportingCurrencyCode;
  activeReportingCurrencyCode = normalizeReportingCurrencyCode(
    pdfOptions?.reportingCurrencyCode ?? prevReporting,
  );
  try {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pw = PDF_LAYOUT.pageHeight;
  const ph = PDF_LAYOUT.pageWidth;
  const allPages: PDFPage[] = [];

  if (!orders.length) {
    const page = pdfDoc.addPage([pw, ph]);
    allPages.push(page);
    drawPdfReportHeader(page, title, font, boldFont);
    let y = getPdfBodyStartY(page);
    if (metadataLines.length) y = drawPdfExtraMetadataLines(page, font, metadataLines, y) - 8;
    page.drawText("No purchase orders in this export.", {
      x: PDF_LAYOUT.margin,
      y: y - 20,
      size: 11,
      font,
      color: PDF_LAYOUT.muted,
    });
    const totalPages = allPages.length;
    allPages.forEach((p, i) => drawPdfReportFooter(p, i + 1, font, totalPages));
    return Buffer.from(await pdfDoc.save());
  }

  for (let oi = 0; oi < orders.length; oi++) {
    const order = orders[oi];
    const sectionFirst = pdfDoc.addPage([pw, ph]);
    const sectionPages: PDFPage[] = [sectionFirst];
    allPages.push(sectionFirst);
    drawPdfReportHeader(sectionFirst, title, font, boldFont);
    let y = getPdfBodyStartY(sectionFirst);
    if (metadataLines.length && oi === 0) {
      y = drawPdfExtraMetadataLines(sectionFirst, font, metadataLines, y) - 18;
    }

    sectionFirst.drawText(sanitizePdfText("Order details"), {
      x: PDF_LAYOUT.margin,
      y,
      size: 12,
      font: boldFont,
      color: PDF_LAYOUT.text,
    });
    y -= 18;

    const supplier = order.supplier ?? {};
    const mid = PDF_LAYOUT.margin + (pw - 2 * PDF_LAYOUT.margin) * 0.46;
    const leftW = mid - PDF_LAYOUT.margin - 10;
    const rightX = mid + 8;
    const rightW = pw - PDF_LAYOUT.margin - rightX - 8;

    let yL = y;
    yL = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, yL, "Supplier", String(supplier.name ?? "—"), leftW);
    if (supplier.address) {
      yL = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, yL, "Address", String(supplier.address), leftW);
    }
    const contactBits = [supplier.contactName, supplier.email, supplier.phone].filter(Boolean);
    if (contactBits.length) {
      yL = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, yL, "Contact", contactBits.join(" - "), leftW);
    }

    let yR = y;
    yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Status", String(order.status ?? "—"), rightW);
    yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Payment", String(order.paymentStatus ?? "—"), rightW);
    yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Order date", formatPdfCell(order.orderDate, { date: true }), rightW);
    if (order.expectedDeliveryDate) {
      yR = drawLabelValueColumn(
        sectionFirst,
        boldFont,
        font,
        rightX,
        yR,
        "Expected delivery",
        formatPdfCell(order.expectedDeliveryDate, { date: true }),
        rightW,
      );
    }
    if (order.deliveryAddress) {
      yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Ship to", String(order.deliveryAddress), rightW);
    }

    y = Math.min(yL, yR) - 12;
    sectionFirst.drawLine({
      start: { x: PDF_LAYOUT.margin, y },
      end: { x: pw - PDF_LAYOUT.margin, y },
      thickness: 0.5,
      color: PDF_LAYOUT.border,
    });
    y -= 16;

    const items = Array.isArray(order.items) ? order.items : [];
    const headers = ["SKU", "Item", "Qty", "Rcvd", "Unit", "Line total"];
    const colWidths = [72, 180, 44, 44, 72, 100];
    const rows = items.map((line: any) => {
      const inv = line.item;
      return [
        formatPdfCell(inv?.sku ?? "—"),
        formatPdfCell(inv?.name ?? "—"),
        formatPdfCell(line.quantity),
        formatPdfCell(line.receivedQuantity ?? 0),
        formatPdfCell(line.unitPrice, { currency: true }),
        formatPdfCell(line.totalPrice, { currency: true }),
      ];
    });
    if (!rows.length) {
      rows.push(["—", "No line items", "—", "—", "—", "—"]);
    }
    rows.push([
      "",
      "",
      "",
      "",
      "Total",
      formatPdfCell(order.totalAmount, { currency: true }),
    ]);

    drawBorderedTableWrapped(pdfDoc, sectionPages, title, headers, colWidths, rows, font, boldFont, y);
    for (let i = 1; i < sectionPages.length; i++) {
      allPages.push(sectionPages[i]);
    }

    appendPurchaseOrderTermsPage(pdfDoc, allPages, title, pw, ph, font, boldFont);
  }

  const totalPages = allPages.length;
  allPages.forEach((p, i) => drawPdfReportFooter(p, i + 1, font, totalPages));
  return Buffer.from(await pdfDoc.save());
  } finally {
    activeReportingCurrencyCode = prevReporting;
  }
}

export type ShipmentDeliveryNoteInput = {
  id: number;
  poNumber: string;
  carrier: string | null;
  status: string;
  eta: Date | null;
  trackingNumber: string | null;
};

/** One-page delivery / packing slip for a single shipment (carrier, PO ref, ETA, tracking, sign-off). */
export async function generateShipmentDeliveryNotePdf(
  shipment: ShipmentDeliveryNoteInput,
  options?: { organizationDisplayName?: string },
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  const titleStem = `Delivery note ${shipment.poNumber}`;
  applyPdfMetadata(pdfDoc, titleStem);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const prevBrand = activePdfBrandName;
  if (options?.organizationDisplayName?.trim()) {
    activePdfBrandName = sanitizePdfText(options.organizationDisplayName.trim()) || APP_NAME;
  }
  try {
    const page = pdfDoc.addPage([PDF_LAYOUT.pageWidth, PDF_LAYOUT.pageHeight]);
    const pw = PDF_LAYOUT.pageWidth;
    const m = PDF_LAYOUT.margin;
    const innerW = pw - 2 * m;
    drawPdfReportHeader(page, titleStem, font, boldFont);
    let y = getPdfBodyStartY(page);
    const heading = `Shipment #${shipment.id}   PO ${shipment.poNumber}`;
    page.drawText(sanitizePdfText(heading), {
      x: m,
      y,
      size: 13,
      font: boldFont,
      color: PDF_LAYOUT.text,
    });
    y -= 24;
    y = drawLabelValueColumn(page, boldFont, font, m, y, "Carrier", (shipment.carrier ?? "").trim() || "—", innerW);
    y = drawLabelValueColumn(page, boldFont, font, m, y, "Status", String(shipment.status ?? "—"), innerW);
    y = drawLabelValueColumn(
      page,
      boldFont,
      font,
      m,
      y,
      "ETA",
      shipment.eta ? formatPdfCell(shipment.eta, { date: true }) : "—",
      innerW,
    );
    y = drawLabelValueColumn(
      page,
      boldFont,
      font,
      m,
      y,
      "Tracking",
      (shipment.trackingNumber ?? "").trim() || "—",
      innerW,
    );
    y -= 10;
    page.drawText(sanitizePdfText("Receiver signature: ________________________________    Date: ______________"), {
      x: m,
      y,
      size: 10,
      font,
      color: PDF_LAYOUT.text,
    });
    y -= 28;
    const noteLines = wrapPdfCellLines(
      "This delivery note records carrier and reference details for the shipment above. Verify quantities and note any damage at receipt.",
      font,
      9,
      innerW,
    );
    for (const ln of noteLines) {
      page.drawText(ln, {
        x: m,
        y,
        size: 9,
        font,
        color: PDF_LAYOUT.muted,
      });
      y -= 11;
    }
    drawPdfReportFooter(page, 1, font, 1);
    return Buffer.from(await pdfDoc.save());
  } finally {
    activePdfBrandName = prevBrand;
  }
}

/** Requisitions with `items`, optional `requestor`, `approver`, `supplier` (from getRequisitionWithDetails). */
export async function generateRequisitionsDocumentPdf(
  requisitions: any[],
  title: string,
  metadataLines: string[] = [],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pw = PDF_LAYOUT.pageHeight;
  const ph = PDF_LAYOUT.pageWidth;
  const allPages: PDFPage[] = [];

  if (!requisitions.length) {
    const page = pdfDoc.addPage([pw, ph]);
    allPages.push(page);
    drawPdfReportHeader(page, title, font, boldFont);
    let y = getPdfBodyStartY(page);
    if (metadataLines.length) y = drawPdfExtraMetadataLines(page, font, metadataLines, y) - 8;
    page.drawText("No requisitions in this export.", {
      x: PDF_LAYOUT.margin,
      y: y - 20,
      size: 11,
      font,
      color: PDF_LAYOUT.muted,
    });
    const totalPages = allPages.length;
    allPages.forEach((p, i) => drawPdfReportFooter(p, i + 1, font, totalPages));
    return Buffer.from(await pdfDoc.save());
  }

  for (let ri = 0; ri < requisitions.length; ri++) {
    const req = requisitions[ri];
    const sectionFirst = pdfDoc.addPage([pw, ph]);
    const sectionPages: PDFPage[] = [sectionFirst];
    allPages.push(sectionFirst);
    drawPdfReportHeader(sectionFirst, title, font, boldFont);
    let y = getPdfBodyStartY(sectionFirst);
    if (metadataLines.length && ri === 0) {
      y = drawPdfExtraMetadataLines(sectionFirst, font, metadataLines, y) - 8;
    }

    sectionFirst.drawText(sanitizePdfText(`Requisition: ${String(req.requisitionNumber ?? `#${req.id}`)}`), {
      x: PDF_LAYOUT.margin,
      y,
      size: 14,
      font: boldFont,
      color: PDF_LAYOUT.text,
    });
    y -= 22;

    const mid = PDF_LAYOUT.margin + (pw - 2 * PDF_LAYOUT.margin) * 0.46;
    const leftW = mid - PDF_LAYOUT.margin - 10;
    const rightX = mid + 8;
    const rightW = pw - PDF_LAYOUT.margin - rightX - 8;

    let yL = y;
    yL = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, yL, "Requestor", userDisplayName(req.requestor), leftW);
    yL = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, yL, "Approver", userDisplayName(req.approver), leftW);
    if (req.supplier?.name) {
      yL = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, yL, "Supplier", String(req.supplier.name), leftW);
    }

    let yR = y;
    yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Status", String(req.status ?? "—"), rightW);
    yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Required date", formatPdfCell(req.requiredDate, { date: true }), rightW);
    yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Approval date", formatPdfCell(req.approvalDate, { date: true }), rightW);
    if (req.rejectionReason) {
      yR = drawLabelValueColumn(sectionFirst, boldFont, font, rightX, yR, "Rejection", String(req.rejectionReason), rightW);
    }

    y = Math.min(yL, yR) - 12;
    if (req.justification) {
      y = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, y, "Justification", String(req.justification), pw - 2 * PDF_LAYOUT.margin);
    }
    if (req.notes) {
      y = drawLabelValueColumn(sectionFirst, boldFont, font, PDF_LAYOUT.margin, y, "Notes", String(req.notes), pw - 2 * PDF_LAYOUT.margin);
    }

    y -= 8;
    sectionFirst.drawLine({
      start: { x: PDF_LAYOUT.margin, y },
      end: { x: pw - PDF_LAYOUT.margin, y },
      thickness: 0.5,
      color: PDF_LAYOUT.border,
    });
    y -= 16;

    const items = Array.isArray(req.items) ? req.items : [];
    const headers = ["SKU", "Item", "Qty", "Unit", "Line total", "Line notes"];
    const colWidths = [72, 160, 40, 72, 80, 148];
    const rows = items.map((line: any) => {
      const inv = line.item;
      return [
        formatPdfCell(inv?.sku ?? "—"),
        formatPdfCell(inv?.name ?? "—"),
        formatPdfCell(line.quantity),
        formatPdfCell(line.unitPrice, { currency: true }),
        formatPdfCell(line.totalPrice, { currency: true }),
        formatPdfCell(line.notes ?? "—"),
      ];
    });
    if (!rows.length) {
      rows.push(["—", "No line items", "—", "—", "—", "—"]);
    }
    rows.push(["", "", "", "Total", formatPdfCell(req.totalAmount, { currency: true }), ""]);

    drawBorderedTableWrapped(pdfDoc, sectionPages, title, headers, colWidths, rows, font, boldFont, y);
    for (let i = 1; i < sectionPages.length; i++) {
      allPages.push(sectionPages[i]);
    }

    const hist = Array.isArray(req.approvalHistoryForPdf) ? req.approvalHistoryForPdf : [];
    if (hist.length > 0) {
      const apFirst = pdfDoc.addPage([pw, ph]);
      const apPages: PDFPage[] = [apFirst];
      allPages.push(apFirst);
      drawPdfReportHeader(apFirst, title, font, boldFont);
      const { height: hAp } = apFirst.getSize();
      let yAp = hAp - PDF_LAYOUT.headerHeight - 20;
      apFirst.drawText(sanitizePdfText(`Approval trail — ${req.requisitionNumber ?? `#${req.id}`}`), {
        x: PDF_LAYOUT.margin,
        y: yAp,
        size: 12,
        font: boldFont,
        color: PDF_LAYOUT.text,
      });
      yAp -= 22;
      const h2 = ["When (UTC)", "Action", "Lvl", "By", "Status chg", "Comment"];
      const cw2 = [102, 76, 28, 108, 108, 194];
      const r2 = hist.map((row: Record<string, unknown>) => {
        const ts = row.performedAt;
        const d = ts != null ? new Date(ts as string | number | Date) : null;
        const when =
          d && !Number.isNaN(d.getTime()) ? format(d, "yyyy-MM-dd HH:mm") : "—";
        return [
          formatPdfCell(when),
          formatPdfCell(row.action),
          formatPdfCell(row.level),
          formatPdfCell(row.performedByLabel ?? row.performedBy ?? "—"),
          formatPdfCell(`${row.previousStatus ?? "—"} -> ${row.newStatus ?? "—"}`),
          formatPdfCell(row.comment ?? "—"),
        ];
      });
      drawBorderedTableWrapped(pdfDoc, apPages, title, h2, cw2, r2, font, boldFont, yAp);
      for (let j = 1; j < apPages.length; j++) {
        allPages.push(apPages[j]);
      }
    }
  }

  const totalPages = allPages.length;
  allPages.forEach((p, i) => drawPdfReportFooter(p, i + 1, font, totalPages));
  return Buffer.from(await pdfDoc.save());
}

export type ActivityLogForPdf = ActivityLog & { userName?: string | null };

/** Chronological audit-style PDF; rows should include `userName` when available. */
export async function generateActivityLogsDocumentPdf(
  logs: ActivityLogForPdf[],
  title: string,
  metadataLines: string[] = [],
): Promise<Buffer> {
  const sorted = [...logs].sort(
    (a, b) =>
      new Date(a.timestamp as string | number | Date).getTime() -
      new Date(b.timestamp as string | number | Date).getTime(),
  );
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pw = PDF_LAYOUT.pageHeight;
  const ph = PDF_LAYOUT.pageWidth;
  const page = pdfDoc.addPage([pw, ph]);
  const pages: PDFPage[] = [page];
  drawPdfReportHeader(page, title, font, boldFont);
  const { height } = page.getSize();
  let yMeta = height - PDF_LAYOUT.headerHeight - 16;
  if (metadataLines.length) {
    yMeta = drawPdfExtraMetadataLines(page, font, metadataLines, yMeta) - 8;
  }
  const oldest = sorted.length ? format(new Date(sorted[0].timestamp as string | number | Date), "yyyy-MM-dd HH:mm") : "—";
  const newest = sorted.length
    ? format(new Date(sorted[sorted.length - 1].timestamp as string | number | Date), "yyyy-MM-dd HH:mm")
    : "—";
  page.drawText(
    sanitizePdfText(
      `Chronological audit log · ${sorted.length} entries · ${oldest} → ${newest} · Export may omit or mask sensitive fields per policy.`,
    ),
    {
      x: PDF_LAYOUT.margin,
      y: yMeta,
      size: 9,
      font,
      color: PDF_LAYOUT.muted,
    },
  );
  const tableTop = yMeta - 14;
  const headers = ["Time (UTC)", "User", "Action", "Description", "Ref type", "Ref ID"];
  const colWidths = [94, 84, 84, 236, 68, 48];
  const rows = sorted.map((log) => {
    const d = new Date(log.timestamp as string | number | Date);
    const timeStr = Number.isNaN(d.getTime()) ? "—" : format(d, "yyyy-MM-dd HH:mm");
    return [
      sanitizePdfText(timeStr),
      formatPdfCell(log.userName ?? "—"),
      formatPdfCell(log.action),
      formatPdfCell(log.description),
      formatPdfCell(log.referenceType ?? "—"),
      formatPdfCell(log.referenceId ?? "—"),
    ];
  });
  if (!rows.length) {
    rows.push(["—", "—", "—", "No activity in range", "—", "—"]);
  }
  drawBorderedTableWrapped(pdfDoc, pages, title, headers, colWidths, rows, font, boldFont, tableTop);
  const totalPages = pages.length;
  pages.forEach((p, i) => drawPdfReportFooter(p, i + 1, font, totalPages));
  return Buffer.from(await pdfDoc.save());
}

export async function generateSupplierProfilePdf(
  supplier: Supplier,
  title: string,
  metadataLines: string[] = [],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pw = PDF_LAYOUT.pageWidth;
  const ph = PDF_LAYOUT.pageHeight;
  const page = pdfDoc.addPage([pw, ph]);
  drawPdfReportHeader(page, title, font, boldFont);
  let y = ph - PDF_LAYOUT.headerHeight - 16;
  if (metadataLines.length) y = drawPdfExtraMetadataLines(page, font, metadataLines, y) - 8;

  page.drawText(sanitizePdfText(`Supplier profile: ${supplier.name}`), {
    x: PDF_LAYOUT.margin,
    y,
    size: 14,
    font: boldFont,
    color: PDF_LAYOUT.text,
  });
  y -= 24;

  const w = pw - 2 * PDF_LAYOUT.margin;
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "General", [supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(" | ") || "—", w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Address", String(supplier.address ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Tax ID", String(supplier.taxIdentificationNumber ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Default currency", String(supplier.defaultCurrencyCode ?? "—"), w);
  y = drawLabelValueColumn(
    page,
    boldFont,
    font,
    PDF_LAYOUT.margin,
    y,
    "Payment terms (master ref.)",
    supplier.paymentTermsId != null ? `#${supplier.paymentTermsId}` : "—",
    w,
  );
  y -= 4;
  page.drawText("Banking", { x: PDF_LAYOUT.margin, y, size: 11, font: boldFont, color: PDF_LAYOUT.accent });
  y -= 16;
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Bank", String(supplier.bankName ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Account", String(supplier.bankAccountNumber ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "SWIFT", String(supplier.bankSwift ?? "—"), w);
  y -= 4;
  page.drawText("Compliance & notes", { x: PDF_LAYOUT.margin, y, size: 11, font: boldFont, color: PDF_LAYOUT.accent });
  y -= 16;
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Insurance expiry", formatPdfCell(supplier.insuranceExpiry, { date: true }), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Compliance", String(supplier.complianceNotes ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Notes", String(supplier.notes ?? "—"), w);
  y -= 4;
  page.drawText("Documents & attachments", {
    x: PDF_LAYOUT.margin,
    y,
    size: 11,
    font: boldFont,
    color: PDF_LAYOUT.accent,
  });
  y -= 16;
  y = drawLabelValueColumn(
    page,
    boldFont,
    font,
    PDF_LAYOUT.margin,
    y,
    "Summary",
    "File versions and retention are tracked in ISS Sourcing (Supplier → Documents). This PDF summarizes master-data fields only.",
    w,
  );

  drawPdfReportFooter(page, 1, font, 1);
  return Buffer.from(await pdfDoc.save());
}

export async function generateWarehouseProfilePdf(
  warehouse: Warehouse,
  title: string,
  metadataLines: string[] = [],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await embedPdfLogoIfNeeded(pdfDoc);
  applyPdfMetadata(pdfDoc, title);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pw = PDF_LAYOUT.pageWidth;
  const ph = PDF_LAYOUT.pageHeight;
  const page = pdfDoc.addPage([pw, ph]);
  const pages: PDFPage[] = [page];
  drawPdfReportHeader(page, title, font, boldFont);
  let y = ph - PDF_LAYOUT.headerHeight - 16;
  if (metadataLines.length) y = drawPdfExtraMetadataLines(page, font, metadataLines, y) - 8;

  page.drawText(sanitizePdfText(`Warehouse: ${warehouse.name}`), {
    x: PDF_LAYOUT.margin,
    y,
    size: 14,
    font: boldFont,
    color: PDF_LAYOUT.text,
  });
  y -= 24;

  const w = pw - 2 * PDF_LAYOUT.margin;
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Location", String(warehouse.location ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Address", String(warehouse.address ?? "—"), w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Contact", [warehouse.contactPerson, warehouse.contactPhone].filter(Boolean).join(" · ") || "—", w);
  y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Default warehouse", warehouse.isDefault ? "Yes" : "No", w);
  if (warehouse.aisle) {
    y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Primary aisle", String(warehouse.aisle), w);
  }
  const aisles = Array.isArray(warehouse.aisles) ? warehouse.aisles : [];
  if (aisles.length) {
    y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Aisles", aisles.join(", "), w);
  }
  const details =
    warehouse.locationDetails && typeof warehouse.locationDetails === "object"
      ? sanitizePdfText(JSON.stringify(warehouse.locationDetails))
      : typeof warehouse.locationDetails === "string" && String(warehouse.locationDetails).trim()
        ? sanitizePdfText(String(warehouse.locationDetails))
        : "";
  if (details) {
    y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Location details (JSON)", details, w);
  }

  const bins = Array.isArray(warehouse.bins) ? warehouse.bins : [];
  if (bins.length > 0) {
    y -= 6;
    page.drawText("Bin locations", {
      x: PDF_LAYOUT.margin,
      y,
      size: 11,
      font: boldFont,
      color: PDF_LAYOUT.accent,
    });
    y -= 16;
    const headers = ["Code", "Aisle", "Row", "Shelf"];
    const colWidths = [120, 100, 100, 100];
    const binRows = bins.map((b: { code?: string; aisle?: string; row?: string; shelf?: string } | string) => {
      if (typeof b === "string" || typeof b === "number") {
        return [formatPdfCell(String(b)), "—", "—", "—"];
      }
      return [
        formatPdfCell(b.code ?? "—"),
        formatPdfCell(b.aisle ?? "—"),
        formatPdfCell(b.row ?? "—"),
        formatPdfCell(b.shelf ?? "—"),
      ];
    });
    drawBorderedTableWrapped(pdfDoc, pages, title, headers, colWidths, binRows, font, boldFont, y);
  } else {
    y = drawLabelValueColumn(page, boldFont, font, PDF_LAYOUT.margin, y, "Bins", "—", w);
  }

  const totalPages = pages.length;
  pages.forEach((p, i) => drawPdfReportFooter(p, i + 1, font, totalPages));
  return Buffer.from(await pdfDoc.save());
}

async function generatePdfByLayout(
  layout: ReportPdfLayout,
  normalizedData: any[],
  title: string,
  columns: { header: string; key: string; width: number }[],
  entry: ReturnType<typeof getReportExportEntry>,
  metadataLines: string[],
): Promise<Buffer> {
  switch (layout) {
    case "purchase_orders":
      return generatePurchaseOrdersDocumentPdf(normalizedData, title, metadataLines);
    case "purchase_requisitions":
      return generateRequisitionsDocumentPdf(normalizedData, title, metadataLines);
    case "activity_logs":
      return generateActivityLogsDocumentPdf(normalizedData as ActivityLogForPdf[], title, metadataLines);
    case "supplier_profile":
      if (normalizedData.length === 1) {
        return generateSupplierProfilePdf(normalizedData[0] as Supplier, title, metadataLines);
      }
      return generateGenericPdf(normalizedData, title, columns, {
        orientation: entry.orientation,
        metadataLines,
        useWrappedTable: entry.pdfWrapCells,
      });
    case "warehouse_profile":
      if (normalizedData.length === 1) {
        return generateWarehouseProfilePdf(normalizedData[0] as Warehouse, title, metadataLines);
      }
      return generateGenericPdf(normalizedData, title, columns, {
        orientation: entry.orientation,
        metadataLines,
        useWrappedTable: entry.pdfWrapCells,
      });
    case "generic":
    default:
      return generateGenericPdf(normalizedData, title, columns, {
        orientation: entry.orientation,
        metadataLines,
        useWrappedTable: entry.pdfWrapCells,
      });
  }
}

/**
 * Generic CSV generator for any data array.
 * Uses UTF-8 BOM + sep=, + CRLF so Excel opens as a clean table.
 */
export async function generateGenericCsv(data: any[], title: string, columns: {header: string; key: string}[]): Promise<Buffer> {
  const lines = [
    CSV_BOM + 'sep=,',
    `"${title.replace(/"/g, '""')}"`,
    `"Generated","${format(new Date(), "yyyy-MM-dd HH:mm")}"`,
    `"Reporting currency (ISO 4217)","${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}"`,
    "",
    columns.map(col => `"${String(col.header).replace(/"/g, '""')}"`).join(','),
  ];
  data.forEach(item => {
    lines.push(columns.map(col => {
      const value = formatExportValue(item[col.key], col.key, true);
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(','));
  });
  return Buffer.from(lines.join(CSV_EOL), 'utf8');
}

/**
 * Generic Excel generator for any data array
 */
export async function generateGenericExcel(data: any[], title: string, columns: {header: string; key: string; width: number}[]): Promise<Buffer> {
  // Create a new workbook and add a worksheet
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet(title.substring(0, 31));
  
  // Set up the columns
  worksheet.columns = columns;
  worksheet.insertRow(1, [title]);
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  const lastColumnLetter = worksheet.getColumn(columns.length).letter;
  worksheet.mergeCells(`A1:${lastColumnLetter}1`);
  worksheet.insertRow(2, [`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}`]);
  worksheet.mergeCells(`A2:${lastColumnLetter}2`);
  worksheet.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };
  worksheet.insertRow(3, [
    `Reporting currency (ISO 4217): ${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}`,
  ]);
  worksheet.mergeCells(`A3:${lastColumnLetter}3`);
  worksheet.getCell("A3").font = { italic: true, color: { argb: "FF64748B" } };
  worksheet.views = [{ state: "frozen", ySplit: 4, activeCell: "A5" }];
  const headerRow = worksheet.getRow(4);
  headerRow.font = { bold: true, color: { argb: "FF0F172A" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  // Add data
  data.forEach(item => {
    const row: any = {};
    
    columns.forEach(col => {
      row[col.key] = formatExportValue(item[col.key], col.key);
    });
    
    worksheet.addRow(row);
  });
  
  for (let rowNumber = 5; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    columns.forEach((column, index) => {
      const isNumeric = PDF_COLUMN_FORMAT[column.key] === "currency" || /amount|price|total|cost|quantity|qty/i.test(column.key);
      if (isNumeric) {
        row.getCell(index + 1).alignment = { vertical: "middle", horizontal: "right" };
      }
    });
  }

  columns.forEach((column, index) => {
    if (PDF_COLUMN_FORMAT[column.key] === "currency") {
      worksheet.getColumn(index + 1).numFmt = '#,##0.00';
    }
  });
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/**
 * Multi-sheet Excel: Summary (metadata) + Data (pivot-friendly flat rows).
 */
async function generateGenericExcelMulti(
  data: any[],
  title: string,
  columns: { header: string; key: string; width: number }[],
  metadataLines: string[],
): Promise<Buffer> {
  const workbook = new Excel.Workbook();
  const summary = workbook.addWorksheet("Summary");
  summary.getCell("A1").value = title;
  summary.getCell("A1").font = { bold: true, size: 14 };
  summary.getCell("A2").value = `Generated (UTC): ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}`;
  summary.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };
  summary.getCell("A3").value = `Row count: ${data.length}`;
  summary.getCell("A4").value = `Reporting currency (ISO 4217): ${normalizeReportingCurrencyCode(activeReportingCurrencyCode)}`;
  let rowNum = 5;
  for (const line of metadataLines) {
    summary.getCell(`A${rowNum}`).value = line;
    rowNum++;
  }
  summary.getColumn(1).width = 52;

  const dataSheet = workbook.addWorksheet("Data");
  dataSheet.columns = columns;
  const headerRow = dataSheet.getRow(1);
  columns.forEach((col, i) => {
    headerRow.getCell(i + 1).value = col.header;
  });
  headerRow.font = { bold: true, color: { argb: "FF0F172A" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;
  dataSheet.views = [{ state: "frozen", ySplit: 1, activeCell: "A2" }];

  data.forEach((item) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col) => {
      row[col.key] = formatExportValue(item[col.key], col.key);
    });
    dataSheet.addRow(row);
  });

  for (let r = 2; r <= dataSheet.rowCount; r++) {
    const row = dataSheet.getRow(r);
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    columns.forEach((column, index) => {
      const isNumeric =
        PDF_COLUMN_FORMAT[column.key] === "currency" ||
        /amount|price|total|cost|quantity|qty/i.test(column.key);
      if (isNumeric) {
        row.getCell(index + 1).alignment = { vertical: "middle", horizontal: "right" };
      }
    });
  }

  columns.forEach((column, index) => {
    if (PDF_COLUMN_FORMAT[column.key] === "currency") {
      dataSheet.getColumn(index + 1).numFmt = "#,##0.00";
    }
  });
  dataSheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

function getDocxAlignmentForColumn(key: string) {
  if (PDF_COLUMN_FORMAT[key] === "currency" || /amount|price|total|cost|quantity|qty/i.test(key)) {
    return AlignmentType.RIGHT;
  }
  if (PDF_COLUMN_FORMAT[key] === "date") {
    return AlignmentType.CENTER;
  }
  return AlignmentType.LEFT;
}

function getDocxColumnWidthPercent(columns: { width: number }[], index: number): number {
  const sum = columns.reduce((acc, col) => acc + Number(col.width || 1), 0) || columns.length;
  const raw = (Number(columns[index]?.width || 1) / sum) * 100;
  return Math.max(6, Math.round(raw));
}

function buildDocxSummaryRows(metrics: Array<{ label: string; value: string }>): TableRow[] {
  return metrics.map((metric) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 35, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: metric.label, bold: true })] })],
        }),
        new TableCell({
          width: { size: 65, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun(metric.value)] })],
        }),
      ],
    }),
  );
}

export async function generateGenericDocx(
  data: any[],
  title: string,
  columns: { header: string; key: string; width: number }[],
): Promise<Buffer> {
  const summaryMetrics = buildGenericSummaryMetrics(data, columns);

  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(
      (col) =>
        new TableCell({
          width: { size: getDocxColumnWidthPercent(columns, columns.findIndex((c) => c.key === col.key)), type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: col.header, bold: true })],
            }),
          ],
        }),
    ),
  });

  const dataRows = (data.length > 0 ? data : [{}]).map(
    (item) =>
      new TableRow({
        children: columns.map((col) => {
          const value =
            data.length > 0
              ? formatExportValue(item[col.key], col.key, true)
              : col === columns[0]
                ? "No records available for selected filters."
                : "";
          return new TableCell({
            width: { size: getDocxColumnWidthPercent(columns, columns.findIndex((c) => c.key === col.key)), type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: getDocxAlignmentForColumn(col.key),
                children: [new TextRun(value.slice(0, 140))],
              }),
            ],
          });
        }),
      }),
  );

  const doc = new DocxDocument({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1100, right: 900, bottom: 1100, left: 900 },
            size: { orientation: PageOrientation.PORTRAIT },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: "InvTrack", bold: true })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun("Page "),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                  new TextRun(" of "),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: title, bold: true, size: 34 })],
          }),
          new Paragraph({
            spacing: { after: 280 },
            children: [new TextRun({ text: `Generated ${format(new Date(), "PPP p")}`, color: "475569" })],
          }),
          new Paragraph({
            spacing: { after: 140 },
            children: [new TextRun({ text: "Summary", bold: true, size: 24 })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: buildDocxSummaryRows(summaryMetrics),
            layout: TableLayoutType.FIXED,
            borders: {
              top: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              bottom: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              left: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              right: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              insideHorizontal: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              insideVertical: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
            },
          }),
          new Paragraph({ spacing: { after: 220 } }),
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: "Detailed Data", bold: true, size: 24 })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...dataRows],
            layout: TableLayoutType.FIXED,
            borders: {
              top: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              bottom: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              left: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              right: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              insideHorizontal: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
              insideVertical: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 1 },
            },
          }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

export async function generateInventoryDocx(
  items: InventoryItem[],
  title: string,
  columns: { header: string; key: string; width: number }[],
): Promise<Buffer> {
  const normalizedRows = items.map((item) => ({
    ...item,
    status:
      item.quantity <= 0
        ? "Out of Stock"
        : (item.lowStockThreshold && item.quantity <= item.lowStockThreshold)
          ? "Low Stock"
          : "In Stock",
  }));
  return generateGenericDocx(normalizedRows, title, columns);
}

/**
 * Create a document generator instance for a specific report type
 */
export function createDocumentGenerator(reportType: ReportType) {
  // Handle inventory-specific reports
  switch (reportType) {
    case 'inventory':
      return {
        pdf: generateInventoryPdf,
        csv: generateInventoryCsv,
        excel: generateInventoryExcel,
        docx: generateInventoryDocx,
      };
    
    // For other reports, return generic handlers
    default: {
      const entry = getReportExportEntry(reportType);
      return {
        pdf: (d: any[], t: string, c: { header: string; key: string; width: number }[], _template: unknown) =>
          generateGenericPdf(d, t, c, {
            orientation: entry.orientation,
            useWrappedTable: entry.pdfWrapCells,
          }),
        csv: generateGenericCsv,
        excel: generateGenericExcel,
        docx: generateGenericDocx,
      };
    }
  }
}

/** Column definitions per report — single source in export-config */
export function getReportColumns(reportType: ReportType) {
  return getReportColumnsFromConfig(reportType);
}

export type PdfTemplate = 'standard' | 'compact' | 'custom';

export interface GenerateDocumentOptions {
  pdfTemplate?: PdfTemplate;
  /** When pdfTemplate is 'custom', use this buffer as cover/template (its pages are prepended to the report). */
  customTemplateBuffer?: Buffer;
  /** Extra lines on PDF (under summary) and Summary sheet in multi-sheet Excel */
  metadataLines?: string[];
  /** Optional org legal line from `organization_settings.report_footer` (Phase 4 branding). */
  organizationFooter?: string;
  /** Optional display name from `organization_settings.display_name` for PDF header/footer. */
  organizationDisplayName?: string;
  /** PNG or JPEG bytes from org logo URL (embedded in PDF header when valid). */
  organizationLogoPng?: Uint8Array;
  /** ISO 4217 reporting currency for monetary amounts (from app_settings.currency_code). */
  reportingCurrencyCode?: string;
}

/**
 * Merge a custom template PDF (e.g. cover page) with the generated report PDF.
 * Template pages come first, then report pages. Uses pdf-lib.
 */
export async function mergePdfWithTemplate(templateBuffer: Buffer, reportBuffer: Buffer): Promise<Buffer> {
  const templateDoc = await PDFDocument.load(templateBuffer);
  const reportDoc = await PDFDocument.load(reportBuffer);
  const templatePages = templateDoc.getPages();
  const reportPages = reportDoc.getPages();
  const merged = await PDFDocument.create();
  for (let i = 0; i < templatePages.length; i++) {
    const [copied] = await merged.copyPages(templateDoc, [i]);
    merged.addPage(copied);
  }
  for (let i = 0; i < reportPages.length; i++) {
    const [copied] = await merged.copyPages(reportDoc, [i]);
    merged.addPage(copied);
  }
  return Buffer.from(await merged.save());
}

/**
 * Generate document based on report type, format, and data.
 * For PDF, options.pdfTemplate selects layout: standard (default), compact, or custom.
 * When custom, options.customTemplateBuffer pages are prepended to the report.
 */
export async function generateDocument(
  reportType: ReportType,
  format: ReportFormat,
  data: any[],
  title: string,
  options?: GenerateDocumentOptions,
): Promise<Buffer> {
  const generator = createDocumentGenerator(reportType);
  const columns = getReportColumns(reportType);
  const entry = getReportExportEntry(reportType);
  const pdfTemplate = options?.pdfTemplate === "custom" ? "standard" : (options?.pdfTemplate ?? "standard");
  const normalizedData = Array.isArray(data) ? data : [];
  const metadataLines = options?.metadataLines ?? [];

  const prevFooter = activePdfOrganizationFooter;
  const prevBrand = activePdfBrandName;
  const prevLogoBytes = activePdfLogoBytes;
  const prevReporting = activeReportingCurrencyCode;
  activePdfOrganizationFooter = options?.organizationFooter?.trim() || undefined;
  activePdfBrandName = sanitizePdfText(options?.organizationDisplayName?.trim() || "") || APP_NAME;
  activePdfLogoBytes =
    options?.organizationLogoPng && options.organizationLogoPng.length > 0
      ? options.organizationLogoPng
      : undefined;
  if (options?.reportingCurrencyCode != null && String(options.reportingCurrencyCode).trim() !== "") {
    activeReportingCurrencyCode = normalizeReportingCurrencyCode(options.reportingCurrencyCode);
  }
  try {
    if (format === "pdf") {
      let reportBuffer: Buffer;
      if (reportType === "inventory") {
        reportBuffer = await generateInventoryPdf(
          normalizedData,
          title,
          columns,
          pdfTemplate as "standard" | "compact",
        );
      } else {
        reportBuffer = await generatePdfByLayout(
          entry.pdfLayout ?? "generic",
          normalizedData,
          title,
          columns,
          entry,
          metadataLines,
        );
      }
      if (options?.pdfTemplate === "custom" && options?.customTemplateBuffer?.length) {
        reportBuffer = await mergePdfWithTemplate(options.customTemplateBuffer, reportBuffer);
      }
      return reportBuffer;
    }
    if (format === "csv") {
      return generator.csv(normalizedData, title, columns);
    }
    if (format === "excel") {
      if (reportType === "inventory") {
        return generator.excel(normalizedData, title, columns);
      }
      return generateGenericExcelMulti(normalizedData, title, columns, metadataLines);
    }
    if (format === "docx") {
      return generator.docx(normalizedData, title, columns);
    }
    throw new Error(`Unsupported format: ${format}`);
  } catch (error) {
    console.error(`Error generating ${format} document for ${reportType}:`, error);
    throw error;
  } finally {
    activePdfOrganizationFooter = prevFooter;
    activePdfBrandName = prevBrand;
    activePdfLogoBytes = prevLogoBytes;
    activeReportingCurrencyCode = prevReporting;
    activePdfLogoImage = null;
  }
}