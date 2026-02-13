# Desktop Application Setup Guide

This document provides instructions for setting up and building the Electron desktop version of the inventory management system.

## Overview

The inventory management system can be run as:
1. A web application hosted on a server
2. A desktop application using Electron

The desktop version provides:
- Better performance for local usage
- Offline capabilities with local data synchronization
- Native operating system integration
- Secure local database for sensitive inventory data

## Prerequisites

Before building the desktop application, ensure you have:

- Node.js (v18.x or later) installed
- npm (v9.x or later) installed
- Git installed
- Required build tools for your operating system:
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: GCC and related build packages

## Development Setup

### 1. Install Dependencies

First, install all required dependencies:

```bash
npm install
```

### 2. Run in Development Mode

To run the application in development mode:

```bash
# Start the development server and Electron app
npm run electron:dev

# OR use the provided script
./start-electron-dev.sh
```

This will start:
- The Express backend server
- The Electron application connected to the backend

### 3. Making Changes

When developing the desktop application:

- Web/UI changes: Modify files in the `client/src` directory
- Electron-specific changes: Modify files in the `electron` directory
- Backend changes: Modify files in the `server` directory

## Building for Distribution

### 1. Prerequisites for Building

Ensure your environment is set up correctly:

```bash
# Install required global packages
npm install -g electron-builder
```

### 2. Build Process

To build the desktop application:

```bash
# Build for the current platform
npm run electron:build

# OR use the provided script
./build-electron.sh
```

This will:
1. Build the React frontend using Vite
2. Compile the server-side code with esbuild
3. Package everything with Electron builder

### 3. Platform-Specific Builds

To build for specific platforms:

```bash
# Windows
npm run electron:build:win

# macOS
npm run electron:build:mac

# Linux
npm run electron:build:linux
```

The build outputs will be available in the `dist` directory.

## Deployment Configuration

### Local Database Setup

The desktop application uses SQLite for local data storage. This is automatically configured when the application is installed.

### Data Synchronization

Configure synchronization settings in the application:

1. Navigate to Settings > Sync
2. Enter your server URL
3. Configure sync frequency and options
4. Enable offline mode if needed

### Auto Updates

The application supports auto-updates:

1. Host the update files on a server
2. Configure `electron-builder.json` with the update URL
3. Build the application with auto-update support enabled

## Troubleshooting

### Common Issues

#### Application Won't Start

- Check logs in `%APPDATA%/inventory-manager/logs` (Windows) or `~/Library/Logs/inventory-manager` (macOS)
- Verify all dependencies are installed
- Check permissions on installation directory

#### Database Errors

- Check SQLite database file integrity
- Verify user has write permissions to the database directory
- Try resetting the database from Settings > Advanced

#### Sync Problems

- Verify server URL is correct
- Check network connectivity
- Ensure server API is compatible with client version

## Advanced Configuration

### Custom Installation

You can customize the installation directory and other options in `electron-builder.json`:

```json
{
  "appId": "com.yourcompany.inventory-manager",
  "productName": "Inventory Manager",
  "directories": {
    "output": "dist"
  },
  "win": {
    "target": ["nsis"],
    "icon": "build/icon.ico"
  },
  "mac": {
    "target": ["dmg"],
    "icon": "build/icon.icns"
  },
  "linux": {
    "target": ["AppImage", "deb"],
    "icon": "build/icon.png"
  }
}
```

### Custom Database Location

To change where data is stored:

1. Modify `electron/db.js` to specify a custom database path
2. Rebuild the application

### Security Considerations

For enhanced security:

1. Enable data encryption in Settings > Security
2. Use strong passwords for application access
3. Regularly backup your database
4. Keep the application updated to the latest version