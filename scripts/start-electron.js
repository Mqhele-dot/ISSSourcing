/**
 * Start script for Electron application in development mode
 * 
 * This script:
 * 1. Starts the Express server
 * 2. Waits for it to be ready
 * 3. Launches the Electron app pointing to the running server
 */

const { spawn } = require('child_process');
const waitOn = require('wait-on');
const path = require('path');
const electronPath = require('electron');

// Log with timestamp
function log(message) {
  const now = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${now}] ${message}`);
}

// Start the server
function startServer() {
  log('Starting server...');
  
  const server = spawn('npm', ['run', 'dev'], {
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'development'
    }
  });
  
  // Forward server output to console
  server.stdout.on('data', (data) => {
    process.stdout.write(data);
  });
  
  server.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
  
  server.on('close', (code) => {
    log(`Server process exited with code ${code}`);
    process.exit(code);
  });
  
  return server;
}

// Start Electron
async function startElectron() {
  try {
    // Wait for the server to start
    log('Waiting for server to start...');
    await waitOn({ resources: ['http://localhost:5000'], timeout: 30000 });
    
    // Server is ready, start Electron
    log('Starting Electron...');
    const electron = spawn(electronPath, [path.join(__dirname, '../electron/main.js')], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    });
    
    electron.on('close', (code) => {
      log(`Electron process exited with code ${code}`);
    });
    
    return electron;
  } catch (error) {
    log(`Error starting Electron: ${error.message}`);
    throw error;
  }
}

// Main function
async function main() {
  log('Starting development environment...');
  
  // Start the server
  const server = startServer();
  
  // Start Electron when the server is ready
  try {
    const electron = await startElectron();
    
    // Handle termination gracefully
    const cleanup = () => {
      log('Shutting down...');
      electron.kill();
      server.kill();
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    // Also handle Electron closing
    electron.on('close', () => {
      log('Electron closed, shutting down server...');
      server.kill();
      process.exit(0);
    });
  } catch (error) {
    log(`Failed to start development environment: ${error.message}`);
    server.kill();
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  log(`An unexpected error occurred: ${error.message}`);
  process.exit(1);
});