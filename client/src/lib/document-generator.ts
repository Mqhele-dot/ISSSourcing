/**
 * Document Generator
 * 
 * This module provides utilities for generating various document formats
 * including PDFs, Excel spreadsheets, and CSV files. It uses the Electron
 * bridge for desktop environments and falls back to web-based alternatives
 * in browser environments.
 */

import { isElectronEnvironment } from './electron-bridge';

// Document generator API for Electron 
// This would be initialized when running in Electron environment
const electronDocumentGenerator = {
  generatePdf: async (templateId: string, data: any, options: any): Promise<string> => {
    // @ts-ignore - window.electron is injected by the Electron preload script
    return await window.electron.invoke('generate-pdf', templateId, data, options);
  },
  generateExcel: async (data: any[], options: any): Promise<string> => {
    // @ts-ignore - window.electron is injected by the Electron preload script
    return await window.electron.invoke('generate-excel', data, options);
  },
  generateCsv: async (data: any[], options: any): Promise<string> => {
    // @ts-ignore - window.electron is injected by the Electron preload script
    return await window.electron.invoke('generate-csv', data, options);
  }
};

// In browser environments, we need to implement web-based alternatives
// These functions will be used when not running in Electron

/**
 * Create a downloadable blob and trigger a download
 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Create a CSV string from data
 */
function createCsvString(data: any[], headers?: string[], delimiter: string = ','): string {
  // If headers are not provided, use the keys from the first data item
  const effectiveHeaders = headers || (data.length > 0 ? Object.keys(data[0]) : []);
  
  // Create header row
  let csv = effectiveHeaders.map(header => 
    // Escape quotes in the header and wrap in quotes
    `"${String(header).replace(/"/g, '""')}"`
  ).join(delimiter) + '\n';
  
  // Add data rows
  data.forEach(item => {
    const row = effectiveHeaders.map(header => {
      const value = item[header] ?? '';
      // Escape quotes in the value and wrap in quotes
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(delimiter);
    csv += row + '\n';
  });
  
  return csv;
}

/**
 * Create a simple HTML table from data (for PDF generation in browser)
 */
function createHtmlTable(data: any[], title: string): string {
  if (data.length === 0) {
    return `<h1>${title}</h1><p>No data available</p>`;
  }
  
  const headers = Object.keys(data[0]);
  
  let html = `
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:nth-child(even) { background-color: #f9f9f9; }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      <table>
        <thead>
          <tr>
  `;
  
  // Add headers
  headers.forEach(header => {
    html += `<th>${header}</th>`;
  });
  
  html += `
          </tr>
        </thead>
        <tbody>
  `;
  
  // Add data rows
  data.forEach(item => {
    html += '<tr>';
    headers.forEach(header => {
      html += `<td>${item[header] ?? ''}</td>`;
    });
    html += '</tr>';
  });
  
  html += `
        </tbody>
      </table>
    </body>
    </html>
  `;
  
  return html;
}

/**
 * Generate a PDF document
 */
export async function generatePdf(
  templateId: string, 
  data: any,
  options: { title?: string; filename?: string } = {}
): Promise<string> {
  // In Electron, use the native PDF generation
  if (isElectronEnvironment()) {
    return electronDocumentGenerator.generatePdf(templateId, data, {
      dialog: true,
    });
  }
  
  // In browser, create a simple HTML representation and open in a new tab
  // This is a fallback - in a real app, you might use a library like jsPDF
  const title = options.title || 'Generated PDF';
  const html = createHtmlTable(Array.isArray(data) ? data : [data], title);
  
  // Create a blob from the HTML
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  // Open in a new tab
  window.open(url, '_blank');
  
  // Clean up
  setTimeout(() => URL.revokeObjectURL(url), 100);
  
  return 'PDF opened in new tab';
}

/**
 * Generate an Excel document
 */
export async function generateExcel(
  data: any[],
  options: { 
    sheetName?: string; 
    filename?: string;
    columns?: Array<{ header: string; key: string; width?: number }>;
  } = {}
): Promise<string> {
  // In Electron, use the native Excel generation
  if (isElectronEnvironment()) {
    return electronDocumentGenerator.generateExcel(data, {
      sheetName: options.sheetName,
      columns: options.columns,
      dialog: true,
    });
  }
  
  // In browser, create a CSV as fallback since Excel is harder to generate
  // In a real app, you might use a library like exceljs
  const filename = options.filename || 'data.csv';
  const headers = options.columns?.map(col => col.header);
  const keys = options.columns?.map(col => col.key);
  
  // If columns are specified, map the data to match the column keys
  let processedData = data;
  if (keys) {
    processedData = data.map(item => {
      const newItem: Record<string, any> = {};
      keys.forEach((key, index) => {
        const header = headers?.[index] || key;
        newItem[header] = item[key];
      });
      return newItem;
    });
  }
  
  const csv = createCsvString(processedData, headers);
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, filename);
  
  return 'CSV download started';
}

/**
 * Generate a CSV document
 */
export async function generateCsv(
  data: any[],
  options: { 
    filename?: string;
    headers?: string[];
    delimiter?: string;
  } = {}
): Promise<string> {
  // In Electron, use the native CSV generation
  if (isElectronEnvironment()) {
    return electronDocumentGenerator.generateCsv(data, {
      headers: options.headers,
      delimiter: options.delimiter,
      dialog: true,
    });
  }
  
  // In browser, generate and download the CSV
  const filename = options.filename || 'data.csv';
  const csv = createCsvString(data, options.headers, options.delimiter);
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, filename);
  
  return 'CSV download started';
}