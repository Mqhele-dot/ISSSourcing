/**
 * Database Setup Script
 * Run this script to initialize the PostgreSQL database
 * Checks if DATABASE_URL is set and executes db:push
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Starting database setup...');

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is not set');
  console.error('Please set DATABASE_URL in your deployment configuration');
  console.error('Format: postgresql://username:password@host:port/database');
  
  // Try to construct from individual environment variables
  if (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE) {
    const port = process.env.PGPORT || '5432';
    process.env.DATABASE_URL = `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${port}/${process.env.PGDATABASE}`;
    console.log('Created DATABASE_URL from individual PostgreSQL environment variables');
  } else {
    console.error('Could not construct DATABASE_URL from environment variables');
    process.exit(1);
  }
}

// Check if drizzle.config.ts exists
const drizzleConfigPath = path.join(__dirname, 'drizzle.config.ts');
if (!fs.existsSync(drizzleConfigPath)) {
  console.error(`Drizzle config file not found at ${drizzleConfigPath}`);
  process.exit(1);
}

console.log('Running database schema push...');

try {
  // Execute drizzle-kit push
  execSync('npx drizzle-kit push', { stdio: 'inherit' });
  console.log('Database schema successfully initialized');
} catch (error) {
  console.error('Failed to initialize database schema:', error.message);
  process.exit(1);
}

console.log('Database setup completed successfully');