#!/bin/bash

# Build Electron application

# Check if production flag is provided
if [ "$1" == "--production" ]; then
  echo "Building Electron application for production..."
  node scripts/build-electron.js --production
else
  echo "Building Electron application for development testing..."
  node scripts/build-electron.js
fi

echo "Build complete. Check the dist_electron directory for the output."