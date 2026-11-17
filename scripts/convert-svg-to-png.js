/**
 * Convert SVG to PNG for Electron icons
 * 
 * This script converts the SVG icon to PNG format for use in Electron.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const svgPath = path.join(__dirname, '../electron/icons/app-icon.svg');
const outputIconPath = path.join(__dirname, '../electron/icons/app-icon.png');
const outputTrayPath = path.join(__dirname, '../electron/icons/tray-icon.png');

async function convertSvgToPng(svgPath, outputPath, size) {
  // Create a canvas with the desired dimensions
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Load the SVG file
  const svgContent = fs.readFileSync(svgPath, 'utf8');
  const svgUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
  
  try {
    // Load the SVG image
    const image = await loadImage(svgUrl);
    
    // Clear the canvas and draw the image
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);
    
    // Convert the canvas to a PNG buffer
    const pngBuffer = canvas.toBuffer('image/png');
    
    // Save the PNG file
    fs.writeFileSync(outputPath, pngBuffer);
    
    console.log(`Converted ${svgPath} to ${outputPath} at ${size}x${size}`);
  } catch (error) {
    console.error('Error converting SVG to PNG:', error);
  }
}

async function main() {
  // Create the application icon
  await convertSvgToPng(svgPath, outputIconPath, 512);
  
  // Create the tray icon (smaller size)
  await convertSvgToPng(svgPath, outputTrayPath, 48);
  
  console.log('Icon conversion complete');
}

main().catch(console.error);