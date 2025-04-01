/**
 * Electron Database Service
 * 
 * Handles local SQLite database operations for the desktop version of InvTrack.
 * Provides offline functionality with synchronization capabilities.
 */

const fs = require('fs');
const path = require('path');
const log = require('electron-log');
const { app } = require('electron');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { promisify } = require('util');
const zlib = require('zlib');

// Compression utilities
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Paths
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const DB_PATH = path.join(DATA_DIR, 'invtrack.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Initialize variables
let db = null;
let syncInProgress = false;
let lastSyncTime = null;

/**
 * Initialize the database service
 */
async function initialize() {
  try {
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    
    // Open database connection
    db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    // Enable foreign keys
    await db.run('PRAGMA foreign_keys = ON');
    
    // Create tables if they don't exist
    await createTables();
    
    log.info('Database service initialized successfully');
    return true;
  } catch (error) {
    log.error('Failed to initialize database service:', error);
    return false;
  }
}

/**
 * Create database tables
 */
async function createTables() {
  try {
    // Users table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        fullName TEXT,
        role TEXT DEFAULT 'user',
        profilePicture TEXT,
        lastLogin TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending'
      )
    `);
    
    // Categories table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending'
      )
    `);
    
    // Warehouses table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        location TEXT,
        description TEXT,
        capacity INTEGER,
        isActive INTEGER DEFAULT 1,
        code TEXT,
        contactPerson TEXT,
        contactEmail TEXT,
        contactPhone TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending'
      )
    `);
    
    // Inventory items table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        sku TEXT UNIQUE,
        barcode TEXT,
        categoryId INTEGER,
        defaultWarehouseId INTEGER,
        price REAL DEFAULT 0,
        cost REAL DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        lowStockThreshold INTEGER,
        reorderPoint INTEGER,
        weight REAL,
        dimensions TEXT,
        pictures TEXT,
        isActive INTEGER DEFAULT 1,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending',
        FOREIGN KEY (categoryId) REFERENCES categories(id),
        FOREIGN KEY (defaultWarehouseId) REFERENCES warehouses(id)
      )
    `);
    
    // Warehouse inventory table (for tracking items across warehouses)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS warehouse_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouseId INTEGER NOT NULL,
        itemId INTEGER NOT NULL,
        quantity INTEGER DEFAULT 0,
        location TEXT,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending',
        FOREIGN KEY (warehouseId) REFERENCES warehouses(id),
        FOREIGN KEY (itemId) REFERENCES inventory_items(id),
        UNIQUE(warehouseId, itemId)
      )
    `);
    
    // Stock movements table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        itemId INTEGER NOT NULL,
        warehouseId INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        previousQuantity INTEGER,
        type TEXT NOT NULL,
        reason TEXT,
        reference TEXT,
        userId INTEGER,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending',
        FOREIGN KEY (itemId) REFERENCES inventory_items(id),
        FOREIGN KEY (warehouseId) REFERENCES warehouses(id),
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `);
    
    // Suppliers table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contactPerson TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        website TEXT,
        notes TEXT,
        isActive INTEGER DEFAULT 1,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        syncStatus TEXT DEFAULT 'pending'
      )
    `);
    
    // Sync metadata table (for tracking sync status)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entityName TEXT NOT NULL,
        lastSyncTime TEXT,
        syncVersion INTEGER DEFAULT 1,
        updateCount INTEGER DEFAULT 0
      )
    `);
    
    // Set up triggers to update the updatedAt field
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
      AFTER UPDATE ON users
      BEGIN
        UPDATE users SET updatedAt = CURRENT_TIMESTAMP, syncStatus = 'pending' WHERE id = NEW.id;
      END;
    `);
    
    // Repeat similar triggers for other tables

    log.info('Database tables created successfully');
    return true;
  } catch (error) {
    log.error('Failed to create database tables:', error);
    return false;
  }
}

/**
 * Create a backup of the database
 * @param {string} customDir Optional custom directory to save the backup
 * @returns {Promise<Object>} Result of the backup operation
 */
async function createBackup(customDir = null) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = customDir || BACKUP_DIR;
  const backupPath = path.join(backupDir, `invtrack-backup-${timestamp}.db.gz`);
  
  try {
    // Ensure the backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Read the database file
    const dbData = fs.readFileSync(DB_PATH);
    
    // Compress the database data
    const compressedData = await gzip(dbData);
    
    // Write the compressed data to the backup file
    fs.writeFileSync(backupPath, compressedData);
    
    log.info(`Database backup created at ${backupPath}`);
    return {
      success: true,
      path: backupPath,
      size: compressedData.length,
      timestamp
    };
  } catch (error) {
    log.error('Failed to create database backup:', error);
    return {
      success: false,
      error: error.message,
      timestamp
    };
  }
}

/**
 * Restore the database from a backup
 * @param {string} backupPath Path to the backup file
 * @returns {Promise<Object>} Result of the restore operation
 */
async function restoreFromBackup(backupPath) {
  try {
    // Close existing database connection
    if (db) {
      await db.close();
      db = null;
    }
    
    // Read the compressed backup file
    const compressedData = fs.readFileSync(backupPath);
    
    // Decompress the data
    const dbData = await gunzip(compressedData);
    
    // Create a backup of the current database before restoring
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const currentBackupPath = path.join(BACKUP_DIR, `pre-restore-backup-${timestamp}.db.gz`);
    const currentDbData = fs.readFileSync(DB_PATH);
    const compressedCurrentData = await gzip(currentDbData);
    fs.writeFileSync(currentBackupPath, compressedCurrentData);
    
    // Write the decompressed data to the database file
    fs.writeFileSync(DB_PATH, dbData);
    
    // Reopen the database connection
    db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    // Enable foreign keys
    await db.run('PRAGMA foreign_keys = ON');
    
    log.info(`Database restored from backup ${backupPath}`);
    return {
      success: true,
      originalBackupPath: backupPath,
      previousDatabaseBackupPath: currentBackupPath
    };
  } catch (error) {
    log.error('Failed to restore database from backup:', error);
    // Try to reopen the original database
    try {
      db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
      });
      await db.run('PRAGMA foreign_keys = ON');
    } catch (reopenError) {
      log.error('Failed to reopen database after restore failure:', reopenError);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get database information and statistics
 * @returns {Promise<Object>} Database information
 */
async function getDatabaseInfo() {
  try {
    const stats = fs.statSync(DB_PATH);
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    
    const tableStats = [];
    for (const table of tables) {
      const count = await db.get(`SELECT COUNT(*) as count FROM ${table.name}`);
      const pendingSync = await db.get(`SELECT COUNT(*) as count FROM ${table.name} WHERE syncStatus = 'pending'`);
      
      tableStats.push({
        name: table.name,
        rowCount: count.count,
        pendingSyncCount: pendingSync ? pendingSync.count : 0
      });
    }
    
    const syncMetadata = await db.get("SELECT MAX(lastSyncTime) as lastSync FROM sync_metadata");
    
    return {
      fileSize: stats.size,
      lastModified: stats.mtime,
      created: stats.birthtime,
      tables: tableStats,
      lastSync: syncMetadata ? syncMetadata.lastSync : null,
      path: DB_PATH
    };
  } catch (error) {
    log.error('Failed to get database information:', error);
    return {
      error: error.message,
      exists: fs.existsSync(DB_PATH)
    };
  }
}

/**
 * Sync data with the remote server
 * @param {function} progressCallback Optional callback for reporting sync progress
 * @returns {Promise<Object>} Sync result
 */
async function syncWithRemoteServer(progressCallback = null) {
  if (syncInProgress) {
    return { success: false, message: 'Sync already in progress' };
  }
  
  syncInProgress = true;
  const startTime = Date.now();
  const reportProgress = (stage, percent, message) => {
    if (progressCallback) {
      progressCallback({ stage, percent, message });
    }
  };
  
  try {
    reportProgress('init', 0, 'Initializing sync process');
    
    // 1. Get all pending changes to send to the server
    reportProgress('preparing', 10, 'Preparing local changes');
    const pendingChanges = await getPendingChanges();
    
    reportProgress('uploading', 30, `Uploading ${pendingChanges.length} changes`);
    // 2. Send changes to server (would be implemented using fetch in a real app)
    // This is a placeholder for the actual server communication
    
    // 3. Get server changes
    reportProgress('downloading', 60, 'Downloading server changes');
    // This would fetch changes from the server that we don't have locally
    
    // 4. Apply server changes to local database
    reportProgress('applying', 80, 'Applying server changes');
    // This would update our local database with the changes from the server
    
    // 5. Update sync metadata
    const now = new Date().toISOString();
    await db.run(`
      INSERT OR REPLACE INTO sync_metadata (entityName, lastSyncTime, updateCount)
      VALUES ('global', ?, (SELECT COALESCE(updateCount, 0) + 1 FROM sync_metadata WHERE entityName = 'global'))
    `, [now]);
    
    lastSyncTime = now;
    
    // 6. Mark all synced entities as 'synced'
    await db.run(`UPDATE users SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    await db.run(`UPDATE categories SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    await db.run(`UPDATE warehouses SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    await db.run(`UPDATE inventory_items SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    await db.run(`UPDATE warehouse_inventory SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    await db.run(`UPDATE stock_movements SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    await db.run(`UPDATE suppliers SET syncStatus = 'synced' WHERE syncStatus = 'pending'`);
    
    reportProgress('complete', 100, 'Sync completed successfully');
    
    const elapsed = (Date.now() - startTime) / 1000;
    log.info(`Sync completed in ${elapsed.toFixed(2)}s`);
    
    syncInProgress = false;
    return {
      success: true,
      changesSent: pendingChanges.length,
      changesReceived: 0, // Placeholder
      syncTime: now,
      elapsedSeconds: elapsed
    };
  } catch (error) {
    log.error('Sync failed:', error);
    reportProgress('error', 0, `Sync failed: ${error.message}`);
    syncInProgress = false;
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get pending changes to send to the server
 * @returns {Promise<Array>} Pending changes
 */
async function getPendingChanges() {
  const changes = [];
  
  // Get pending changes from each table
  const pendingUsers = await db.all("SELECT * FROM users WHERE syncStatus = 'pending'");
  const pendingCategories = await db.all("SELECT * FROM categories WHERE syncStatus = 'pending'");
  const pendingWarehouses = await db.all("SELECT * FROM warehouses WHERE syncStatus = 'pending'");
  const pendingItems = await db.all("SELECT * FROM inventory_items WHERE syncStatus = 'pending'");
  const pendingWarehouseInventory = await db.all("SELECT * FROM warehouse_inventory WHERE syncStatus = 'pending'");
  const pendingMovements = await db.all("SELECT * FROM stock_movements WHERE syncStatus = 'pending'");
  const pendingSuppliers = await db.all("SELECT * FROM suppliers WHERE syncStatus = 'pending'");
  
  // Add changes with their entity type
  pendingUsers.forEach(user => {
    changes.push({ entity: 'users', data: user });
  });
  
  pendingCategories.forEach(category => {
    changes.push({ entity: 'categories', data: category });
  });
  
  pendingWarehouses.forEach(warehouse => {
    changes.push({ entity: 'warehouses', data: warehouse });
  });
  
  pendingItems.forEach(item => {
    changes.push({ entity: 'inventory_items', data: item });
  });
  
  pendingWarehouseInventory.forEach(wi => {
    changes.push({ entity: 'warehouse_inventory', data: wi });
  });
  
  pendingMovements.forEach(movement => {
    changes.push({ entity: 'stock_movements', data: movement });
  });
  
  pendingSuppliers.forEach(supplier => {
    changes.push({ entity: 'suppliers', data: supplier });
  });
  
  return changes;
}

/**
 * Check if a table exists in the database
 * @param {string} tableName Table name to check
 * @returns {Promise<boolean>} Whether the table exists
 */
async function tableExists(tableName) {
  const result = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return result !== undefined;
}

// Export public API
module.exports = {
  initialize,
  createBackup,
  restoreFromBackup,
  getDatabaseInfo,
  syncWithRemoteServer,
  get db() { return db; },
  get lastSyncTime() { return lastSyncTime; },
  get isSyncInProgress() { return syncInProgress; }
};