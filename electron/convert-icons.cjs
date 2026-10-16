const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

// Function to convert SVG to PNG
async function convertSvgToPng(svgPath, outputPath, size) {
  try {
    // Load SVG
    console.log(`Converting ${svgPath} to PNG with size ${size}x${size}...`);
    const img = await loadImage(svgPath);
    
    // Create canvas
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Draw image
    ctx.drawImage(img, 0, 0, size, size);
    
    // Write to file
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    
    console.log(`Converted ${svgPath} to ${outputPath}`);
  } catch (error) {
    console.error(`Error converting ${svgPath}:`, error);
  }
}

// Ensure icons directory exists
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Convert app icon
const appSvgPath = path.join(iconsDir, 'app-icon.svg');
const appPngPath = path.join(iconsDir, 'app-icon.png');
convertSvgToPng(appSvgPath, appPngPath, 512);

// Convert tray icon
const traySvgPath = path.join(iconsDir, 'tray-icon.svg');
const trayPngPath = path.join(iconsDir, 'tray-icon.png');
convertSvgToPng(traySvgPath, trayPngPath, 256);

console.log('Icon conversion complete.');