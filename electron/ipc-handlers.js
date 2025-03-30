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
  let scannerWindow = null;
  let cameraActive = false;
  let onScanCallback = null;
  
  // Start the barcode scanner
  ipcMain.handle('start-barcode-scanner', async (event, options = {}) => {
    try {
      const mainWindow = BrowserWindow.fromWebContents(event.sender);
      if (!mainWindow) {
        throw new Error('Parent window not found');
      }
      
      // Set up callback for scan results
      onScanCallback = (result) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send('barcode-scan-result', result);
      };
      
      // Determine scanner type
      const scannerType = options.type || 'auto';
      
      // Create scanner window
      scannerWindow = new BrowserWindow({
        width: 800,
        height: 600,
        parent: mainWindow,
        modal: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        },
      });
      
      // Load the scanner HTML (using a data URL for simplicity)
      scannerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Barcode Scanner</title>
          <style>
            body, html {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              font-family: system-ui, sans-serif;
              background: #000;
              color: #fff;
              overflow: hidden;
            }
            #scanner-container {
              width: 100%;
              height: 100%;
              display: flex;
              flex-direction: column;
            }
            #scanner {
              flex: 1;
              position: relative;
              overflow: hidden;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            #scanner video {
              max-width: 100%;
              max-height: 100%;
            }
            #scanner-overlay {
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5);
              pointer-events: none;
            }
            .scanner-targeting {
              position: absolute;
              top: 50%;
              left: 50%;
              width: 250px;
              height: 250px;
              transform: translate(-50%, -50%);
              border: 2px solid rgba(255, 255, 255, 0.5);
              border-radius: 1rem;
              box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5);
            }
            .scanner-targeting::before, 
            .scanner-targeting::after {
              content: '';
              position: absolute;
              width: 20px;
              height: 20px;
              border-color: #fff;
              border-style: solid;
            }
            .scanner-targeting::before {
              top: -2px;
              left: -2px;
              border-width: 2px 0 0 2px;
              border-radius: 1rem 0 0 0;
            }
            .scanner-targeting::after {
              bottom: -2px;
              right: -2px;
              border-width: 0 2px 2px 0;
              border-radius: 0 0 1rem 0;
            }
            .controls {
              height: 60px;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 0 1rem;
              background: #111;
            }
            .controls button {
              background: #2563eb;
              color: #fff;
              border: none;
              border-radius: 4px;
              padding: 8px 16px;
              font-size: 14px;
              cursor: pointer;
              margin: 0 8px;
            }
            .controls button:hover {
              background: #1d4ed8;
            }
            .controls button.secondary {
              background: #374151;
            }
            .controls button.secondary:hover {
              background: #1f2937;
            }
            .status {
              padding: 8px 16px;
              font-size: 14px;
              color: #a3a3a3;
            }
            #manual-entry {
              display: none;
              width: 100%;
              height: 100%;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 1rem;
            }
            #manual-entry input {
              width: 100%;
              max-width: 300px;
              padding: 8px 12px;
              font-size: 16px;
              border-radius: 4px;
              border: 1px solid #374151;
              margin-bottom: 16px;
            }
            #manual-entry p {
              margin-bottom: 16px;
              color: #a3a3a3;
            }
          </style>
        </head>
        <body>
          <div id="scanner-container">
            <div id="scanner">
              <div id="scanner-overlay">
                <div class="scanner-targeting"></div>
              </div>
            </div>
            <div class="controls">
              <button id="toggle-camera">Stop Camera</button>
              <button id="manual-button" class="secondary">Manual Entry</button>
              <button id="close-button" class="secondary">Close</button>
            </div>
            <div class="status" id="status">Scanning...</div>
          </div>
          <div id="manual-entry">
            <p>Enter barcode value manually:</p>
            <input type="text" id="manual-input" placeholder="e.g. 123456789012">
            <div class="controls" style="width: 100%">
              <button id="submit-manual">Submit</button>
              <button id="cancel-manual" class="secondary">Cancel</button>
            </div>
          </div>
          <script>
            const scannerContainer = document.getElementById('scanner-container');
            const manualEntry = document.getElementById('manual-entry');
            const scanner = document.getElementById('scanner');
            const toggleCameraBtn = document.getElementById('toggle-camera');
            const manualBtn = document.getElementById('manual-button');
            const closeBtn = document.getElementById('close-button');
            const submitManualBtn = document.getElementById('submit-manual');
            const cancelManualBtn = document.getElementById('cancel-manual');
            const manualInput = document.getElementById('manual-input');
            const statusEl = document.getElementById('status');
            
            let cameraStream = null;
            let videoElement = null;
            
            // Initialize camera
            async function startCamera() {
              try {
                toggleCameraBtn.textContent = 'Stop Camera';
                
                // Get camera stream
                const constraints = {
                  video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                  }
                };
                
                cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
                
                // Create video element
                videoElement = document.createElement('video');
                videoElement.srcObject = cameraStream;
                videoElement.autoplay = true;
                videoElement.setAttribute('playsinline', 'true');
                scanner.appendChild(videoElement);
                
                // Notify main process
                window.electron.send('barcode-scanner:camera-started');
                statusEl.textContent = 'Camera active. Scanning...';
                
                // Start looking for barcodes (simulation for this example)
                startBarcodeDetection();
              } catch (error) {
                console.error('Error starting camera:', error);
                statusEl.textContent = 'Camera error: ' + error.message;
                window.electron.send('barcode-scanner:camera-error', error.message);
              }
            }
            
            // Stop camera
            function stopCamera() {
              toggleCameraBtn.textContent = 'Start Camera';
              
              if (cameraStream) {
                cameraStream.getTracks().forEach(track => track.stop());
                cameraStream = null;
              }
              
              if (videoElement && videoElement.parentNode) {
                videoElement.parentNode.removeChild(videoElement);
                videoElement = null;
              }
              
              window.electron.send('barcode-scanner:camera-stopped');
              statusEl.textContent = 'Camera stopped';
            }
            
            // Simulate barcode detection
            // In a real application, this would use a barcode detection library
            function startBarcodeDetection() {
              // Simulate random scanning time between 1-5 seconds
              const randomInterval = Math.floor(Math.random() * 4000) + 1000;
              
              setTimeout(() => {
                // Only continue if camera is still active
                if (!cameraStream) return;
                
                // Generate a random barcode (UPC-A format, 12 digits)
                const randomBarcode = Array.from(
                  { length: 12 }, 
                  () => Math.floor(Math.random() * 10)
                ).join('');
                
                // Send the result to the main process
                window.electron.send('barcode-scanner:result', {
                  text: randomBarcode,
                  format: 'UPC_A',
                  timestamp: Date.now()
                });
                
                statusEl.textContent = 'Detected: ' + randomBarcode;
                
                // Automatically close after scan (optional)
                // window.close();
              }, randomInterval);
            }
            
            // Toggle camera
            toggleCameraBtn.addEventListener('click', () => {
              if (cameraStream) {
                stopCamera();
              } else {
                startCamera();
              }
            });
            
            // Toggle manual entry
            manualBtn.addEventListener('click', () => {
              scannerContainer.style.display = 'none';
              manualEntry.style.display = 'flex';
              if (cameraStream) {
                stopCamera();
              }
            });
            
            // Return to scanner from manual entry
            cancelManualBtn.addEventListener('click', () => {
              scannerContainer.style.display = 'flex';
              manualEntry.style.display = 'none';
            });
            
            // Submit manual entry
            submitManualBtn.addEventListener('click', () => {
              const value = manualInput.value.trim();
              if (value) {
                window.electron.send('barcode-scanner:result', {
                  text: value,
                  format: 'MANUAL',
                  timestamp: Date.now()
                });
                // Close after manual entry
                window.close();
              }
            });
            
            // Allow Enter key to submit
            manualInput.addEventListener('keypress', (e) => {
              if (e.key === 'Enter') {
                submitManualBtn.click();
              }
            });
            
            // Close button
            closeBtn.addEventListener('click', () => {
              window.close();
            });
            
            // Start camera on load
            document.addEventListener('DOMContentLoaded', startCamera);
            
            // Clean up on close
            window.addEventListener('beforeunload', () => {
              if (cameraStream) {
                stopCamera();
              }
            });
          </script>
        </body>
        </html>
      `)}`);
      
      // Handle scanner window events
      scannerWindow.once('ready-to-show', () => {
        scannerWindow.show();
        cameraActive = true;
      });
      
      scannerWindow.on('closed', () => {
        cameraActive = false;
        scannerWindow = null;
      });
      
      // Return success
      return { success: true };
    } catch (error) {
      console.error('Error starting barcode scanner:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Stop the barcode scanner
  ipcMain.handle('stop-barcode-scanner', () => {
    try {
      if (scannerWindow) {
        scannerWindow.close();
        scannerWindow = null;
      }
      cameraActive = false;
      onScanCallback = null;
      return { success: true };
    } catch (error) {
      console.error('Error stopping barcode scanner:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Handle result from the scanner window
  ipcMain.on('barcode-scanner:result', (_, result) => {
    if (onScanCallback) {
      onScanCallback(result);
    }
    
    // Optionally close the scanner window after a successful scan
    if (scannerWindow) {
      setTimeout(() => {
        if (scannerWindow) {
          scannerWindow.close();
          scannerWindow = null;
        }
      }, 500);
    }
  });
  
  // Monitor scanner status
  ipcMain.on('barcode-scanner:camera-started', () => {
    cameraActive = true;
  });
  
  ipcMain.on('barcode-scanner:camera-stopped', () => {
    cameraActive = false;
  });
  
  ipcMain.on('barcode-scanner:camera-error', (_, errorMessage) => {
    console.error('Camera error:', errorMessage);
    cameraActive = false;
  });
  
  // Generate barcodes and QR codes
  ipcMain.handle('barcode:generate', async (_, options) => {
    try {
      // In a real application, this would use a barcode generation library
      // For now, we'll just simulate success
      return {
        success: true,
        message: `Generated ${options.type} with value ${options.value}`
      };
    } catch (error) {
      console.error('Error generating barcode:', error);
      return { success: false, error: error.message };
    }
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