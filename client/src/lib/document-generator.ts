/**
 * Document Generator Utility
 * 
 * This module provides functions for generating documents in various formats.
 * When running in Electron, it uses the native document generation capabilities.
 * When running in a browser, it falls back to browser-based solutions.
 */

import { documentControls, isElectron } from "./electron-bridge";

// Define common export options
export interface ExportOptions {
  fileName?: string;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
}

// Define PDF export options
export interface PdfExportOptions extends ExportOptions {
  template?: string;
  orientation?: "portrait" | "landscape";
  pageSize?: "A4" | "Letter" | "Legal";
  margins?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

// Define Excel export options
export interface ExcelExportOptions extends ExportOptions {
  sheetName?: string;
  includeHeaders?: boolean;
  headerStyle?: any; // Could be expanded to include styling options
  cellStyles?: any;  // Could be expanded to include styling options
}

// Define CSV export options
export interface CsvExportOptions extends ExportOptions {
  delimiter?: string;
  includeHeaders?: boolean;
  quoteStrings?: boolean;
}

/**
 * Generate a PDF document from data
 * @param data The data to include in the PDF
 * @param options Options for the PDF generation
 * @returns Promise with the path to the saved file or a Blob if in browser mode
 */
export async function generatePdf(data: any, options: PdfExportOptions = {}): Promise<string | Blob | null> {
  // In Electron, use the native PDF generation
  if (isElectron) {
    const templateName = options.template || "default";
    return await documentControls.generatePdf(data, templateName, options);
  }
  
  // In browser, implement fallback or return null
  console.warn("PDF generation in browser not implemented");
  return null;
}

/**
 * Export data to Excel format
 * @param data Array of data objects to export
 * @param options Options for the Excel export
 * @returns Promise with the path to the saved file or a Blob if in browser mode
 */
export async function exportToExcel(data: any[], options: ExcelExportOptions = {}): Promise<string | Blob | null> {
  // In Electron, use the native Excel export
  if (isElectron) {
    return await documentControls.exportToExcel(data, options);
  }
  
  // In browser, implement fallback or return null
  console.warn("Excel export in browser not implemented");
  return null;
}

/**
 * Export data to CSV format
 * @param data Array of data objects to export
 * @param options Options for the CSV export
 * @returns Promise with the path to the saved file or a Blob if in browser mode
 */
export async function exportToCsv(data: any[], options: CsvExportOptions = {}): Promise<string | Blob | null> {
  // In Electron, use the native CSV export
  if (isElectron) {
    return await documentControls.exportToCsv(data, options);
  }
  
  // In browser, implement fallback or return null
  console.warn("CSV export in browser not implemented");
  return null;
}

/**
 * Set up document generation event listeners
 * @param callbacks Object containing callback functions for different export types
 * @returns Cleanup function to remove event listeners
 */
export function setupDocumentListeners(callbacks: {
  onExcelExport?: () => void;
  onCsvExport?: () => void;
  onPdfExport?: () => void;
}): () => void {
  if (!isElectron) {
    return () => {}; // No-op if not in Electron
  }
  
  const cleanupFunctions: Array<() => void> = [];
  
  if (callbacks.onExcelExport) {
    cleanupFunctions.push(documentControls.onExportExcelRequest(callbacks.onExcelExport));
  }
  
  if (callbacks.onCsvExport) {
    cleanupFunctions.push(documentControls.onExportCsvRequest(callbacks.onCsvExport));
  }
  
  if (callbacks.onPdfExport) {
    cleanupFunctions.push(documentControls.onExportPdfRequest(callbacks.onPdfExport));
  }
  
  // Return a cleanup function that calls all individual cleanup functions
  return () => {
    cleanupFunctions.forEach(cleanup => cleanup());
  };
}

export default {
  generatePdf,
  exportToExcel,
  exportToCsv,
  setupDocumentListeners
};