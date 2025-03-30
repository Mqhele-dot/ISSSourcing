/**
 * Build script for Electron desktop application
 * 
 * This script handles the build process for creating an Electron desktop application:
 * 1. Builds the React frontend with Vite
 * 2. Compiles the server-side code with esbuild
 * 3. Prepares the Electron application structure
 * 4. Packages everything together
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const isProduction = process.argv.includes('--production');
const isDev = !isProduction;
const platform = process.platform;

// Log with timestamp
function log(message) {
  const now = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${now}] ${message}`);
}

// Execute a command and log its output
function execute(command) {
  log(`Executing: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    log(`Error executing command: ${error.message}`);
    return false;
  }
}

// Main build function
async function buildElectron() {
  log('Starting Electron build process...');
  
  // Step 1: Convert SVG icons to PNG
  log('Converting icons...');
  execute('node scripts/convert-svg-to-png.js');
  
  // Step 2: Build the frontend
  log('Building frontend...');
  if (!execute('npm run build')) {
    log('Frontend build failed, aborting.');
    process.exit(1);
  }

  // Step 3: Create a directory for the Electron build
  const electronDistDir = path.join(__dirname, '../dist_electron');
  if (!fs.existsSync(electronDistDir)) {
    fs.mkdirSync(electronDistDir, { recursive: true });
  }
  
  // Step 4: Package the Electron application
  log('Packaging Electron application...');
  if (isProduction) {
    // For production, use electron-builder to create installers
    if (!execute('npx electron-builder build --publish never')) {
      log('Electron packaging failed, aborting.');
      process.exit(1);
    }
  } else {
    // For development/testing, create a simple package
    log('Creating development package...');
    
    // Copy necessary files
    const filesToCopy = [
      'electron/**/*',
      'dist/**/*',
      'package.json',
      'electron-builder.json'
    ];
    
    // Use rsync or copy command depending on platform
    if (platform === 'win32') {
      filesToCopy.forEach(glob => {
        execute(`xcopy "${glob.replace(/\//g, '\\')}" "${path.join(electronDistDir, glob).replace(/\//g, '\\')}" /E /I /Y`);
      });
    } else {
      filesToCopy.forEach(glob => {
        execute(`cp -r ${glob} ${electronDistDir}/`);
      });
    }
    
    log('Creating package.json for Electron app...');
    const packageJson = require(path.join(__dirname, '../package.json'));
    const electronPackageJson = {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      main: 'electron/main.js',
      scripts: {
        start: 'electron .'
      },
      dependencies: {
        // Include only the dependencies needed for Electron runtime
        electron: packageJson.dependencies.electron
      }
    };
    
    fs.writeFileSync(
      path.join(electronDistDir, 'package.json'),
      JSON.stringify(electronPackageJson, null, 2)
    );
  }
  
  log('Electron build completed successfully!');
  log(`The packaged application can be found in: ${electronDistDir}`);
}

// Run the build
buildElectron().catch(error => {
  log(`Build failed with error: ${error.message}`);
  process.exit(1);
});