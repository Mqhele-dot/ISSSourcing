// Reorder Requests report generators
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Excel from 'exceljs';

export async function generateReorderRequestsPdfReport(requests: any[], title: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
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
  const headers = ['Request #', 'Item', 'Status', 'Quantity', 'Created Date', 'Created By', 'Approval Date'];
  const colWidths = [100, 150, 70, 50, 80, 80, 80];
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
  
  for (const request of requests) {
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
    
    // First column: Request Number
    currentPage.drawText(request.requestNumber, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[0];
    
    // Second column: Item ID or Item Name if possible
    const itemName = request.item ? request.item.name : `Item #${request.itemId}`;
    currentPage.drawText(itemName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[1];
    
    // Third column: Status
    currentPage.drawText(request.status, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[2];
    
    // Fourth column: Quantity
    currentPage.drawText(request.quantity.toString(), {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[3];
    
    // Fifth column: Created Date
    const createdDate = new Date(request.createdAt).toLocaleDateString();
    currentPage.drawText(createdDate, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[4];
    
    // Sixth column: Created By
    const requestorName = request.requestor ? request.requestor.name : 'N/A';
    currentPage.drawText(requestorName, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    xPos += colWidths[5];
    
    // Seventh column: Approval Date
    const approvalDate = request.approvalDate ? new Date(request.approvalDate).toLocaleDateString() : 'Pending';
    currentPage.drawText(approvalDate, {
      x: xPos,
      y: yPos,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    });
    
    yPos -= 15;
  }
  
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export async function generateReorderRequestsCsvReport(requests: any[], title: string): Promise<Buffer> {
  // Create CSV headers
  const csvContent = [
    ['Request #', 'Item', 'Status', 'Quantity', 'Created Date', 'Created By', 'Approval Date', 'Notes'].join(','),
    ...requests.map(request => {
      const createdDate = new Date(request.createdAt).toLocaleDateString();
      const approvalDate = request.approvalDate ? new Date(request.approvalDate).toLocaleDateString() : '';
      const itemName = request.item ? request.item.name : `Item #${request.itemId}`;
      const requestorName = request.requestor ? request.requestor.name : '';
      
      return [
        request.requestNumber,
        itemName,
        request.status,
        request.quantity,
        createdDate,
        requestorName,
        approvalDate,
        request.notes || ''
      ].map(value => `"${value}"`).join(',');
    })
  ].join('\n');
  
  return Buffer.from(csvContent);
}

export async function generateReorderRequestsExcelReport(requests: any[], title: string): Promise<Buffer> {
  // Create a new workbook and add a worksheet
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet('Reorder Requests');
  
  // Set up the columns
  worksheet.columns = [
    { header: 'Request #', key: 'requestNumber', width: 15 },
    { header: 'Item', key: 'item', width: 30 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Created Date', key: 'createdDate', width: 15 },
    { header: 'Created By', key: 'createdBy', width: 20 },
    { header: 'Approval Date', key: 'approvalDate', width: 15 },
    { header: 'Approved By', key: 'approvedBy', width: 20 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];
  
  // Style the header row
  worksheet.getRow(1).font = { bold: true };
  
  // Add title as a merged cell before the headers
  worksheet.insertRow(1, [title]);
  worksheet.getCell('A1').font = { bold: true, size: 14 };
  worksheet.mergeCells('A1:I1');
  
  // Add data
  requests.forEach(request => {
    const createdDate = new Date(request.createdAt).toLocaleDateString();
    const approvalDate = request.approvalDate ? new Date(request.approvalDate).toLocaleDateString() : '';
    const itemName = request.item ? request.item.name : `Item #${request.itemId}`;
    const requestorName = request.requestor ? request.requestor.name : '';
    const approverName = request.approver ? request.approver.name : '';
    
    worksheet.addRow({
      requestNumber: request.requestNumber,
      item: itemName,
      status: request.status,
      quantity: request.quantity,
      createdDate: createdDate,
      createdBy: requestorName,
      approvalDate: approvalDate,
      approvedBy: approverName,
      notes: request.notes || ''
    });
  });
  
  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}