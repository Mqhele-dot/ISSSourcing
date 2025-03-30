/**
 * IPC Handlers for Electron
 * 
 * This module defines all the IPC (Inter-Process Communication) handlers
 * for the Electron application, allowing the renderer process (web app)
 * to safely communicate with the main process (Node.js).
 */

const { ipcMain, BrowserWindow, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const Excel = require('exceljs');
const db = require('./db');
const os = require('os');
const { createObjectCsvWriter } = require('csv-writer');

// Window Management Handlers
function handleWindowControls() {
  // Minimize the window
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  // Maximize or restore the window
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  // Close the window
  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  // Check if the window is maximized
  ipcMain.handle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });
}

// Application Handlers
function handleAppControls() {
  // Get application version
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  // Get application data directory
  ipcMain.handle('app:get-data-directory', () => {
    return app.getPath('userData');
  });

  // Check for updates (implement with electron-updater in production)
  ipcMain.on('app:check-updates', (event) => {
    // This is a placeholder. In a real application, use electron-updater
    // to check for updates from your update server
    const updateInfo = {
      version: '1.0.1',
      releaseDate: new Date().toISOString(),
      releaseNotes: 'Bug fixes and performance improvements'
    };
    
    event.sender.send('update-available', updateInfo);
    
    // Simulate download completion after a delay
    setTimeout(() => {
      event.sender.send('update-downloaded', updateInfo);
    }, 3000);
  });

  // Install update and restart (implement with electron-updater in production)
  ipcMain.on('app:install-update', () => {
    // This is a placeholder. In a real application, use electron-updater
    // to quit and install
    app.relaunch();
    app.quit();
  });
}

// Document Generation Handlers
function handleDocumentGeneration() {
  // Generate PDF document
  ipcMain.handle('document:generate-pdf', async (_, data, templateName, options = {}) => {
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 12;
      
      page.drawText('InvTrack - Generated Report', {
        x: 50,
        y: height - 50,
        size: 24,
        font,
        color: rgb(0, 0, 0),
      });
      
      page.drawText(`Template: ${templateName}`, {
        x: 50,
        y: height - 100,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      
      page.drawText(`Date: ${new Date().toLocaleDateString()}`, {
        x: 50,
        y: height - 120,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      
      // Output data content
      let y = height - 160;
      if (typeof data === 'string') {
        page.drawText(data, {
          x: 50,
          y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      } else if (Array.isArray(data)) {
        for (const item of data) {
          page.drawText(JSON.stringify(item), {
            x: 50,
            y,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
          y -= 20;
          
          // Add a new page if we run out of space
          if (y < 50) {
            const newPage = pdfDoc.addPage();
            y = newPage.getSize().height - 50;
          }
        }
      } else if (typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          page.drawText(`${key}: ${value}`, {
            x: 50,
            y,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
          y -= 20;
          
          // Add a new page if we run out of space
          if (y < 50) {
            const newPage = pdfDoc.addPage();
            y = newPage.getSize().height - 50;
          }
        }
      }
      
      const pdfBytes = await pdfDoc.save();
      
      // Determine the output file path
      const fileName = options.fileName || `${templateName}-${Date.now()}.pdf`;
      const directory = options.directory || app.getPath('downloads');
      const filePath = path.join(directory, fileName);
      
      fs.writeFileSync(filePath, pdfBytes);
      
      return filePath;
    } catch (error) {
      console.error('Error generating PDF:', error);
      return null;
    }
  });

  // Export data to Excel
  ipcMain.handle('document:export-excel', async (_, data, options = {}) => {
    try {
      const workbook = new Excel.Workbook();
      const worksheet = workbook.addWorksheet(options.sheetName || 'Data');
      
      if (Array.isArray(data) && data.length > 0) {
        // Create header row from first object's keys
        const headers = Object.keys(data[0]);
        worksheet.columns = headers.map(header => ({
          header,
          key: header,
          width: 20
        }));
        
        // Add data rows
        worksheet.addRows(data);
      }
      
      // Determine the output file path
      const fileName = options.fileName || `Export-${Date.now()}.xlsx`;
      const directory = options.directory || app.getPath('downloads');
      const filePath = path.join(directory, fileName);
      
      await workbook.xlsx.writeFile(filePath);
      
      return filePath;
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      return null;
    }
  });

  // Export data to CSV
  ipcMain.handle('document:export-csv', async (_, data, options = {}) => {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Data must be a non-empty array');
      }
      
      // Determine the output file path
      const fileName = options.fileName || `Export-${Date.now()}.csv`;
      const directory = options.directory || app.getPath('downloads');
      const filePath = path.join(directory, fileName);
      
      // Create CSV header from first object's keys
      const headers = Object.keys(data[0]).map(key => ({
        id: key,
        title: key
      }));
      
      const csvWriter = createObjectCsvWriter({
        path: filePath,
        header: headers
      });
      
      await csvWriter.writeRecords(data);
      
      return filePath;
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      return null;
    }
  });
}

// Dialog Handlers
function handleDialogs() {
  // Open file dialog
  ipcMain.handle('dialog:open-file', async (_, options = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: options.title,
      defaultPath: options.defaultPath || app.getPath('documents'),
      buttonLabel: options.buttonLabel,
      filters: options.filters || [
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: options.properties || ['openFile']
    });
    
    return canceled ? null : filePaths[0];
  });

  // Save file dialog
  ipcMain.handle('dialog:save-file', async (_, options = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: options.title,
      defaultPath: options.defaultPath || app.getPath('documents'),
      buttonLabel: options.buttonLabel,
      filters: options.filters || [
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    return canceled ? null : filePath;
  });
}

// Barcode Scanner Handlers
function handleBarcodeScanner() {
  // Scan barcode (placeholder implementation)
  ipcMain.handle('barcode:scan', async (_) => {
    // In a real application, this would integrate with a camera API
    // or a hardware barcode scanner
    
    // For demo purposes, show a dialog asking for manual input
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Cancel', 'Scan'],
      defaultId: 1,
      title: 'Barcode Scanner',
      message: 'Barcode Scanner Simulation',
      detail: 'In a real application, this would activate your camera or barcode scanner. For now, please enter a barcode value manually.',
      checkboxLabel: 'Show this dialog again',
      checkboxChecked: true
    });
    
    if (response === 0) {
      return null; // User canceled
    }
    
    // Prompt for manual barcode input
    const { canceled, value } = await dialog.showInputBox({
      title: 'Enter Barcode',
      message: 'Please enter a barcode value:',
      buttons: ['Cancel', 'OK'],
      type: 'question'
    });
    
    return canceled ? null : value;
  });
}

// Database Handlers
function handleDatabase() {
  // Create database backup
  ipcMain.handle('database:create-backup', async (_, options = {}) => {
    try {
      const directory = options.directory || app.getPath('documents');
      const backupPath = await db.createBackup(directory);
      return backupPath;
    } catch (error) {
      console.error('Error creating database backup:', error);
      return null;
    }
  });

  // Restore database from backup
  ipcMain.handle('database:restore', async (_, backupPath) => {
    try {
      await db.restoreFromBackup(backupPath);
      return true;
    } catch (error) {
      console.error('Error restoring database:', error);
      return false;
    }
  });
}

/**
 * Register all IPC handlers with the main process
 */
function registerIpcHandlers() {
  handleWindowControls();
  handleAppControls();
  handleDocumentGeneration();
  handleDialogs();
  handleBarcodeScanner();
  handleDatabase();
}

module.exports = {
  registerIpcHandlers
};