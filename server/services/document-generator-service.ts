// Document generator service
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Excel from 'exceljs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { 
  InventoryItem, 
  ReorderRequest, 
  User, 
  Supplier, 
  Warehouse, 
  Category, 
  PurchaseOrder, 
  PurchaseRequisition,
  ReportType,
  ReportFormat,
  reportTypeEnum,
  reportFormatEnum
} from '@shared/schema';
import { format } from 'date-fns';

const pipelineAsync = promisify(pipeline);

/**
 * Generate a PDF document from inventory data
 */
export async function generateInventoryPdf(items: InventoryItem[], title: string, _columns?: any[]): Promise<Buffer> {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Add a page to the document
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Add title
  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  // Add date
  const dateStr = new Date().toLocaleDateString();
  page.drawText(`Generated on: ${dateStr}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Add headers
  const headers = ['SKU', 'Name', 'Category', 'Quantity', 'Price', 'Status'];
  const colWidths = [80, 150, 80, 60, 80, 80];
  let yPos = height - 100;
  let xPos = 50;
  
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: xPos,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[i];
  });
  
  // Draw a line
  page.drawLine({
    start: { x: 50, y: yPos - 5 },
    end: { x: width - 50, y: yPos - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  // Add data rows
  yPos -= 20;
  
  for (const item of items) {
    if (yPos < 50) {
      // Add a new page if we're running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPos = height - 50;
      
      // Add headers to new page
      xPos = 50;
      headers.forEach((header, i) => {
        newPage.drawText(header, {
          x: xPos,
          y: yPos,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        xPos += colWidths[i];
      });
      
      // Draw a line
      newPage.drawLine({
        start: { x: 50, y: yPos - 5 },
        end: { x: width - 50, y: yPos - 5 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 20;
    }
    
    const currentPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
    
    // SKU
    xPos = 50;
    currentPage.drawText(item.sku || 'N/A', {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    // Name
    xPos += colWidths[0];
    currentPage.drawText(item.name, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    // Category
    xPos += colWidths[1];
    currentPage.drawText(item.categoryId ? `${item.categoryId}` : 'N/A', {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    // Quantity
    xPos += colWidths[2];
    currentPage.drawText(item.quantity.toString(), {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    // Price
    xPos += colWidths[3];
    currentPage.drawText(`$${item.price.toFixed(2)}`, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    // Status
    xPos += colWidths[4];
    const status = item.quantity <= 0 ? 'Out of Stock' : 
                  (item.lowStockThreshold && item.quantity <= item.lowStockThreshold) ? 'Low Stock' : 
                  'In Stock';
    currentPage.drawText(status, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    yPos -= 15;
  }
  
  // Serialize the PDF document to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Generate a CSV document from inventory data
 */
export async function generateInventoryCsv(items: InventoryItem[], title: string, _columns?: any[]): Promise<Buffer> {
  // Create CSV headers
  const csvContent = [
    ['SKU', 'Name', 'Description', 'Category', 'Quantity', 'Price', 'Cost', 'Status', 'Low Stock Threshold'].join(','),
    ...items.map(item => {
      const status = item.quantity <= 0 ? 'Out of Stock' : 
                    (item.lowStockThreshold && item.quantity <= item.lowStockThreshold) ? 'Low Stock' : 
                    'In Stock';
      
      return [
        item.sku || '',
        item.name,
        item.description || '',
        item.categoryId || '',
        item.quantity,
        item.price.toFixed(2),
        item.cost?.toFixed(2) || '',
        status,
        item.lowStockThreshold || ''
      ].map(value => `"${value}"`).join(',');
    })
  ].join('\n');
  
  return Buffer.from(csvContent);
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
  
  // Style the header row
  worksheet.getRow(1).font = { bold: true };
  
  // Add title as a merged cell before the headers
  worksheet.insertRow(1, [title]);
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.mergeCells('A1:J1');
  
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
      price: item.price.toFixed(2),
      cost: item.cost?.toFixed(2) || '',
      status: status,
      lowStockThreshold: item.lowStockThreshold || '',
      lastUpdated: item.updatedAt ? format(new Date(item.updatedAt), 'yyyy-MM-dd HH:mm') : ''
    });
  });
  
  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/**
 * Generic PDF generator for any data array
 */
export async function generateGenericPdf(data: any[], title: string, columns: {header: string; key: string; width: number}[]): Promise<Buffer> {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // Add a page to the document
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  
  // Add title
  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  
  // Add date
  const dateStr = new Date().toLocaleDateString();
  page.drawText(`Generated on: ${dateStr}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  
  // Add headers
  const headers = columns.map(c => c.header);
  const colWidths = columns.map(c => c.width);
  let yPos = height - 100;
  let xPos = 50;
  
  headers.forEach((header, i) => {
    page.drawText(header, {
      x: xPos,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[i];
  });
  
  // Draw a line
  page.drawLine({
    start: { x: 50, y: yPos - 5 },
    end: { x: width - 50, y: yPos - 5 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  
  // Add data rows
  yPos -= 20;
  
  for (const item of data) {
    if (yPos < 50) {
      // Add a new page if we're running out of space
      const newPage = pdfDoc.addPage([612, 792]);
      yPos = height - 50;
      
      // Add headers to new page
      xPos = 50;
      headers.forEach((header, i) => {
        newPage.drawText(header, {
          x: xPos,
          y: yPos,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        xPos += colWidths[i];
      });
      
      // Draw a line
      newPage.drawLine({
        start: { x: 50, y: yPos - 5 },
        end: { x: width - 50, y: yPos - 5 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 20;
    }
    
    const currentPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
    xPos = 50;
    
    // Draw each column value
    columns.forEach((col, i) => {
      let valueText = 'N/A';
      
      if (item[col.key] !== undefined && item[col.key] !== null) {
        valueText = item[col.key].toString();
      }
      
      // Truncate text if too long
      if (valueText.length > 25) {
        valueText = valueText.substring(0, 22) + '...';
      }
      
      currentPage.drawText(valueText, {
        x: xPos,
        y: yPos,
        size: 9,
        font,
        color: rgb(0, 0, 0),
      });
      
      xPos += colWidths[i];
    });
    
    yPos -= 15;
  }
  
  // Serialize the PDF document to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Generic CSV generator for any data array
 */
export async function generateGenericCsv(data: any[], title: string, columns: {header: string; key: string}[]): Promise<Buffer> {
  // Create CSV headers
  const csvContent = [
    columns.map(col => col.header).join(','),
    ...data.map(item => {
      return columns.map(col => {
        let value = item[col.key] !== undefined && item[col.key] !== null ? item[col.key] : '';
        
        // Convert dates to readable format
        if (value instanceof Date) {
          value = format(value, 'yyyy-MM-dd HH:mm');
        }
        
        // Escape quotes and wrap in quotes
        return `"${String(value).replace(/"/g, '""')}"`;
      }).join(',');
    })
  ].join('\n');
  
  return Buffer.from(csvContent);
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
  
  // Style the header row
  worksheet.getRow(1).font = { bold: true };
  
  // Add title as a merged cell before the headers
  worksheet.insertRow(1, [title]);
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.mergeCells(`A1:${String.fromCharCode(64 + columns.length)}1`);
  
  // Add data
  data.forEach(item => {
    const row: any = {};
    
    columns.forEach(col => {
      let value = item[col.key];
      
      // Handle special cases
      if (value instanceof Date) {
        value = format(value, 'yyyy-MM-dd HH:mm');
      } else if (value === null || value === undefined) {
        value = '';
      }
      
      row[col.key] = value;
    });
    
    worksheet.addRow(row);
  });
  
  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
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
        excel: generateInventoryExcel
      };
    
    // For other reports, return generic handlers
    default:
      return {
        pdf: generateGenericPdf,
        csv: generateGenericCsv,
        excel: generateGenericExcel
      };
  }
}

/**
 * Get column definitions for each report type
 */
export function getReportColumns(reportType: ReportType) {
  switch (reportType) {
    case 'inventory':
      return [
        { header: 'SKU', key: 'sku', width: 15 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Category', key: 'categoryId', width: 15 },
        { header: 'Quantity', key: 'quantity', width: 10 },
        { header: 'Price', key: 'price', width: 12 },
        { header: 'Cost', key: 'cost', width: 12 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Low Stock Threshold', key: 'lowStockThreshold', width: 20 }
      ];

    case 'categories':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Description', key: 'description', width: 50 }
      ];

    case 'suppliers':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Contact Name', key: 'contactName', width: 30 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Phone', key: 'phone', width: 20 },
        { header: 'Address', key: 'address', width: 50 }
      ];

    case 'warehouses':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Location', key: 'location', width: 30 },
        { header: 'Contact Person', key: 'contactPerson', width: 30 },
        { header: 'Contact Phone', key: 'contactPhone', width: 20 },
        { header: 'Address', key: 'address', width: 50 },
        { header: 'Is Default', key: 'isDefault', width: 15 }
      ];

    case 'reorder_requests':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Request Number', key: 'requestNumber', width: 20 },
        { header: 'Item', key: 'itemName', width: 30 },
        { header: 'Quantity', key: 'quantity', width: 15 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Requested By', key: 'requestorName', width: 30 },
        { header: 'Supplier', key: 'supplierName', width: 30 },
        { header: 'Warehouse', key: 'warehouseName', width: 30 },
        { header: 'Date Requested', key: 'createdAt', width: 20 }
      ];

    case 'purchase_orders':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Order Number', key: 'orderNumber', width: 20 },
        { header: 'Supplier', key: 'supplierName', width: 30 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Order Date', key: 'orderDate', width: 20 },
        { header: 'Expected Delivery', key: 'expectedDeliveryDate', width: 20 },
        { header: 'Total Amount', key: 'totalAmount', width: 15 },
        { header: 'Payment Status', key: 'paymentStatus', width: 20 }
      ];

    case 'purchase_requisitions':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Requisition Number', key: 'requisitionNumber', width: 20 },
        { header: 'Requestor', key: 'requestorName', width: 30 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Required Date', key: 'requiredDate', width: 20 },
        { header: 'Supplier', key: 'supplierName', width: 30 },
        { header: 'Total Amount', key: 'totalAmount', width: 15 },
        { header: 'Approval Date', key: 'approvalDate', width: 20 }
      ];

    case 'users':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Username', key: 'username', width: 20 },
        { header: 'Full Name', key: 'fullName', width: 30 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Role', key: 'role', width: 20 },
        { header: 'Active', key: 'active', width: 10 },
        { header: 'Last Login', key: 'lastLogin', width: 20 }
      ];

    case 'stock_movements':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Date', key: 'createdAt', width: 20 },
        { header: 'Item', key: 'itemName', width: 30 },
        { header: 'From Warehouse', key: 'fromWarehouseName', width: 25 },
        { header: 'To Warehouse', key: 'toWarehouseName', width: 25 },
        { header: 'Quantity', key: 'quantity', width: 15 },
        { header: 'Type', key: 'movementType', width: 20 },
        { header: 'Reference', key: 'reference', width: 20 },
        { header: 'User', key: 'userName', width: 20 }
      ];

    case 'activity_logs':
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Timestamp', key: 'timestamp', width: 20 },
        { header: 'User', key: 'userName', width: 20 },
        { header: 'Action', key: 'action', width: 20 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'Reference Type', key: 'referenceType', width: 20 },
        { header: 'Reference ID', key: 'referenceId', width: 15 }
      ];

    default:
      return [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Description', key: 'description', width: 50 }
      ];
  }
}

/**
 * Generate document based on report type, format, and data
 */
export async function generateDocument(reportType: ReportType, format: ReportFormat, data: any[], title: string): Promise<Buffer> {
  const generator = createDocumentGenerator(reportType);
  const columns = getReportColumns(reportType);
  
  try {
    if (format === 'pdf') {
      if (reportType === 'inventory') {
        return generator.pdf(data, title, columns);
      } else {
        return generator.pdf(data, title, columns);
      }
    } else if (format === 'csv') {
      if (reportType === 'inventory') {
        return generator.csv(data, title, columns);
      } else {
        return generator.csv(data, title, columns);
      }
    } else if (format === 'excel') {
      if (reportType === 'inventory') {
        return generator.excel(data, title, columns);
      } else {
        return generator.excel(data, title, columns);
      }
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    console.error(`Error generating ${format} document for ${reportType}:`, error);
    throw error;
  }
}