/**
 * Electron Main Process
 * 
 * This is the entry point for the Electron application.
 * It creates the browser window, sets up the application menu,
 * and handles various system events.
 */

const { app, BrowserWindow, Menu, Tray, shell, dialog } = require('electron');
const path = require('path');
const url = require('url');
const { is } = require('electron-util');
const fs = require('fs');
const { registerIpcHandlers } = require('./ipc-handlers');
const db = require('./db');

// Keep a global reference of objects to prevent garbage collection
let mainWindow;
let tray;
let isQuitting = false;

// Check if we're in development or production
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Check for updates (placeholder implementation)
 * In a real application, use electron-updater
 */
function checkForUpdates() {
  if (isDev) {
    console.log('Skipping update check in development mode');
    return;
  }
  
  console.log('Checking for updates...');
  // This is where you would implement the actual update check
  // using electron-updater
}

/**
 * Create the main application window
 */
function createMainWindow() {
  const windowConfig = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true,
      devTools: isDev
    },
    // Remove the default frame in favor of our custom one
    frame: false,
    // Disable the traffic lights on macOS
    titleBarStyle: 'hidden',
    show: false
  };
  
  mainWindow = new BrowserWindow(windowConfig);
  
  // Load the application
  const startUrl = isDev
    ? 'http://localhost:5000' // Development server
    : url.format({
        pathname: path.join(__dirname, '../dist/index.html'),
        protocol: 'file:',
        slashes: true
      });
  
  mainWindow.loadURL(startUrl);
  
  // Show window when it's ready to avoid flickering
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for updates on startup
    checkForUpdates();
  });
  
  // Handle window close events
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      // Prevent the window from closing
      event.preventDefault();
      
      // Ask the user if they want to quit
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        title: 'Confirm',
        message: 'Are you sure you want to quit?',
        detail: 'Any unsaved changes will be lost.'
      }).then(({ response }) => {
        if (response === 0) {
          isQuitting = true;
          mainWindow.close();
        }
      });
    }
  });
  
  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  // Prevent navigation to non-local URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  
  // Set up the application menu
  createAppMenu();
  
  // Set up the system tray icon
  createTray();
  
  // Return the window for further use
  return mainWindow;
}

/**
 * Create the application menu
 */
function createAppMenu() {
  const isMac = process.platform === 'darwin';
  
  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Data',
          submenu: [
            {
              label: 'Export to Excel',
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu:export-excel');
                }
              }
            },
            {
              label: 'Export to CSV',
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu:export-csv');
                }
              }
            },
            {
              label: 'Export to PDF',
              click: () => {
                if (mainWindow) {
                  mainWindow.webContents.send('menu:export-pdf');
                }
              }
            }
          ]
        },
        {
          label: 'Database',
          submenu: [
            {
              label: 'Create Backup',
              click: async () => {
                try {
                  const { filePath } = await dialog.showSaveDialog({
                    title: 'Save Database Backup',
                    defaultPath: path.join(app.getPath('documents'), `invtrack-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`),
                    buttonLabel: 'Save Backup',
                    filters: [
                      { name: 'Database Files', extensions: ['db'] },
                      { name: 'All Files', extensions: ['*'] }
                    ]
                  });
                  
                  if (filePath) {
                    const backupDir = path.dirname(filePath);
                    const backupPath = await db.createBackup(backupDir);
                    dialog.showMessageBox({
                      type: 'info',
                      title: 'Backup Created',
                      message: 'Database backup created successfully',
                      detail: `Backup saved to: ${backupPath}`
                    });
                  }
                } catch (error) {
                  dialog.showErrorBox('Backup Error', `Failed to create backup: ${error.message}`);
                }
              }
            },
            {
              label: 'Restore from Backup',
              click: async () => {
                try {
                  const { filePaths, canceled } = await dialog.showOpenDialog({
                    title: 'Select Database Backup',
                    defaultPath: app.getPath('documents'),
                    buttonLabel: 'Restore',
                    filters: [
                      { name: 'Database Files', extensions: ['db'] },
                      { name: 'All Files', extensions: ['*'] }
                    ],
                    properties: ['openFile']
                  });
                  
                  if (!canceled && filePaths.length > 0) {
                    const { response } = await dialog.showMessageBox({
                      type: 'warning',
                      title: 'Confirm Restore',
                      message: 'Are you sure you want to restore the database?',
                      detail: 'This will overwrite your current data. This operation cannot be undone.',
                      buttons: ['Cancel', 'Restore'],
                      defaultId: 0,
                      cancelId: 0
                    });
                    
                    if (response === 1) {
                      await db.restoreFromBackup(filePaths[0]);
                      dialog.showMessageBox({
                        type: 'info',
                        title: 'Restore Complete',
                        message: 'Database restored successfully',
                        detail: 'The application will now restart to apply the changes.'
                      });
                      
                      // Restart the application
                      app.relaunch();
                      app.exit();
                    }
                  }
                } catch (error) {
                  dialog.showErrorBox('Restore Error', `Failed to restore database: ${error.message}`);
                }
              }
            }
          ]
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    
    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://electronjs.org');
          }
        },
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://example.com/docs');
          }
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => {
            checkForUpdates();
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              title: 'About InvTrack',
              message: 'InvTrack - Inventory Management System',
              detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\nChrome: ${process.versions.chrome}`
            });
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Create the system tray icon
 */
function createTray() {
  const iconPath = path.join(__dirname, '../icons/tray-icon.png');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open InvTrack',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('InvTrack - Inventory Management System');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Initialize the database module
  db.initialize();
  
  // Register all IPC handlers
  registerIpcHandlers();
  
  // Create the main window
  createMainWindow();
  
  // On macOS, re-create a window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS where it's common
// for applications to stay running until the user explicitly quits
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, force quit when Command+Q is pressed
app.on('before-quit', () => {
  isQuitting = true;
});