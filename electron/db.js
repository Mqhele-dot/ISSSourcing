/**
 * Database Module for Electron
 *
 * This module handles local data storage for the Electron application.
 * It manages database initialization, backup, and restoration.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;

// Define database paths
let DATA_DIRECTORY;
let DB_FILE;
let BACKUPS_DIRECTORY;

/**
 * Initialize the data directory structure
 */
function initializeDataDirectory() {
  DATA_DIRECTORY = path.join(app.getPath('userData'), 'data');
  DB_FILE = path.join(DATA_DIRECTORY, 'invtrack.db');
  BACKUPS_DIRECTORY = path.join(DATA_DIRECTORY, 'backups');

  // Create directories if they don't exist
  if (!fs.existsSync(DATA_DIRECTORY)) {
    fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
  }

  if (!fs.existsSync(BACKUPS_DIRECTORY)) {
    fs.mkdirSync(BACKUPS_DIRECTORY, { recursive: true });
  }
}

/**
 * Create a backup of the database
 * @param {string} customDirectory Optional custom directory to save the backup to
 * @returns {Promise<string>} Path to the backup file
 */
async function createBackup(customDirectory = null) {
  // Create a timestamped backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `invtrack-backup-${timestamp}.db`;
  
  // Determine the backup directory
  const backupDir = customDirectory || BACKUPS_DIRECTORY;
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const backupPath = path.join(backupDir, backupFileName);
  
  // Copy the database file to the backup location
  try {
    await fsPromises.copyFile(DB_FILE, backupPath);
    console.log(`Backup created at: ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.error('Error creating database backup:', error);
    throw error;
  }
}

/**
 * Restore the database from a backup file
 * @param {string} backupPath Path to the backup file
 * @returns {Promise<void>}
 */
async function restoreFromBackup(backupPath) {
  try {
    // Validate the backup file
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    // Create a backup of the current database before restoring
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preRestoreBackupPath = path.join(
      BACKUPS_DIRECTORY,
      `pre-restore-backup-${timestamp}.db`
    );
    
    // Create a backup before restoring (if the current database exists)
    if (fs.existsSync(DB_FILE)) {
      await fsPromises.copyFile(DB_FILE, preRestoreBackupPath);
    }
    
    // Copy the backup file to the database location
    await fsPromises.copyFile(backupPath, DB_FILE);
    
    console.log(`Database restored from: ${backupPath}`);
    console.log(`Pre-restore backup created at: ${preRestoreBackupPath}`);
    
    return true;
  } catch (error) {
    console.error('Error restoring database:', error);
    throw error;
  }
}

/**
 * Initialize the database
 */
function initializeDatabase() {
  // Simple check if database exists
  if (!fs.existsSync(DB_FILE)) {
    console.log('Database does not exist. Creating empty database file.');
    fs.writeFileSync(DB_FILE, '', { encoding: 'utf8' });
  }
}

/**
 * Initialize the database module
 */
function initialize() {
  console.log('Initializing database module...');
  initializeDataDirectory();
  initializeDatabase();
  console.log('Database initialized.');
}

/**
 * Get the database instance
 * This is a placeholder for more complex database implementations
 * such as SQLite, IndexedDB, etc.
 */
function getDb() {
  // In a real application, this would return a database connection or ORM instance
  return {
    path: DB_FILE,
    backupsPath: BACKUPS_DIRECTORY
  };
}

/**
 * Get database information and statistics
 * @returns {Object} Database information
 */
async function getDatabaseInfo() {
  try {
    // Check if database file exists
    const dbExists = fs.existsSync(DB_FILE);
    
    // Get file stats
    let stats = null;
    let size = '0 KB';
    
    if (dbExists) {
      stats = fs.statSync(DB_FILE);
      // Convert to human-readable size
      const fileSizeInBytes = stats.size;
      const fileSizeInKB = fileSizeInBytes / 1024;
      if (fileSizeInKB < 1024) {
        size = `${fileSizeInKB.toFixed(2)} KB`;
      } else {
        const fileSizeInMB = fileSizeInKB / 1024;
        size = `${fileSizeInMB.toFixed(2)} MB`;
      }
    }
    
    // Get the most recent backup if any
    let lastBackup = null;
    if (fs.existsSync(BACKUPS_DIRECTORY)) {
      const backupFiles = fs.readdirSync(BACKUPS_DIRECTORY)
        .filter(file => file.startsWith('invtrack-backup-'))
        .sort();
      
      if (backupFiles.length > 0) {
        const latestBackupFile = backupFiles[backupFiles.length - 1];
        const backupStats = fs.statSync(path.join(BACKUPS_DIRECTORY, latestBackupFile));
        lastBackup = backupStats.mtime.toISOString();
      }
    }
    
    // In a real application, we would query the database to get record counts
    // For this example, we'll just return placeholder data
    return {
      status: dbExists ? 'healthy' : 'error',
      size,
      location: DB_FILE,
      lastBackup,
      dataCount: {
        inventory: 0,  // Would fetch from database in real app
        movements: 0,  // Would fetch from database in real app
        suppliers: 0,  // Would fetch from database in real app
        users: 0       // Would fetch from database in real app
      }
    };
  } catch (error) {
    console.error('Error getting database info:', error);
    return {
      status: 'error',
      size: '0 KB',
      location: DB_FILE,
      lastBackup: null,
      dataCount: {
        inventory: 0,
        movements: 0,
        suppliers: 0,
        users: 0
      }
    };
  }
}

/**
 * Synchronize the local database with the remote server
 * @param {Function} progressCallback Optional callback to report sync progress
 * @returns {Promise<boolean>} Whether sync was successful
 */
async function syncDatabase(progressCallback = null) {
  // In a real application, this would sync data with a remote server
  // For now, we'll simulate the process with timeouts
  
  try {
    console.log('Starting database synchronization...');
    
    // Simulate sync progress
    const totalSteps = 5;
    
    for (let step = 1; step <= totalSteps; step++) {
      // Calculate progress percentage
      const progress = Math.floor((step / totalSteps) * 100);
      
      // Report progress if a callback is provided
      if (typeof progressCallback === 'function') {
        progressCallback(progress);
      }
      
      console.log(`Sync progress: ${progress}%`);
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Update a timestamp file to record successful sync
    const syncTimestampFile = path.join(DATA_DIRECTORY, 'last_sync.txt');
    fs.writeFileSync(syncTimestampFile, new Date().toISOString());
    
    console.log('Database synchronization completed successfully');
    return true;
  } catch (error) {
    console.error('Error synchronizing database:', error);
    return false;
  }
}

// Export the module
module.exports = {
  initialize,
  getDb,
  createBackup,
  restoreFromBackup,
  getDatabaseInfo,
  syncDatabase
};