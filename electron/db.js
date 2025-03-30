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

// Export the module
module.exports = {
  initialize,
  getDb,
  createBackup,
  restoreFromBackup
};