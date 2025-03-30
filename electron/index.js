/**
 * Electron Application Entry Point
 * 
 * This is the bootstrapping file for the Electron application.
 * It sets up the environment and launches the main process.
 */

// Import electron-updater for auto-updates in production
// This is commented out for now, uncomment and install when ready to implement
// const { autoUpdater } = require('electron-updater');

// Set environment variables
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || (require('electron').app.isPackaged ? 'production' : 'development');

// Import the main process file
require('./main');