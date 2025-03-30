# Desktop Application Setup Guide

This guide provides instructions on how to run and build the desktop version of the Inventory Management System.

## Prerequisites

Before getting started, ensure you have the following installed:
- Node.js (latest LTS version)
- npm (comes with Node.js)
- Git

## Running the Desktop App for Development

### Step 1: Clone the Repository (if you haven't already)

```bash
git clone <repository-url>
cd <repository-directory>
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Start the Desktop App in Development Mode

```bash
./start-electron-dev.sh
```

This will:
1. Start the Express server
2. Wait for it to be ready
3. Launch the Electron app pointing to the running server

## Testing Real-time Sync Functionality

1. In the desktop app, navigate to `/sync-test` in the application
2. Use the connection controls to connect to the WebSocket server
3. Send test messages and observe real-time updates across instances

## Building the Desktop App for Distribution

### Building for Development Testing

To build a development version of the desktop app:

```bash
./build-electron.sh
```

The built application will be in the `dist_electron` directory.

### Building for Production

To build a production-ready version of the desktop app with installers:

```bash
./build-electron.sh --production
```

This will create:
- Windows: NSIS installer (.exe)
- macOS: DMG and ZIP (.dmg, .zip)
- Linux: AppImage and Debian package (.AppImage, .deb)

The built packages will be in the `dist_electron` directory.

## Application Features

The desktop application includes all features of the web application plus:

1. **Offline Functionality**: Work without an internet connection
2. **Local Database**: Store data locally with synchronization capabilities
3. **Custom Desktop UI**: Native window controls and desktop-specific components
4. **Real-time Sync**: Synchronize data across multiple instances
5. **Database Management**: Create backups and restore from them
6. **Document Generation**: Export data to PDF, Excel, and CSV formats
7. **Native System Integration**: File system access and native dialogs

## Troubleshooting

If you encounter issues:

1. **Application Won't Start**: Check the console output for errors
2. **Build Errors**: Ensure all dependencies are installed
3. **Real-time Sync Issues**: Verify WebSocket connections are working
4. **Icon Conversion Errors**: Ensure the SVG icons are properly formatted

For more detailed information or support, please refer to the main documentation or contact the development team.