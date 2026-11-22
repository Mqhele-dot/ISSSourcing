/**
 * Convert SVG Icons to PNG
 * 
 * This utility script converts SVG icons to PNG format for use in the
 * Electron application. It uses the canvas package to perform the conversion.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

/**
 * Convert an SVG file to a PNG file
 * @param {string} svgPath - Path to the source SVG file
 * @param {string} outputPath - Path to save the output PNG file
 * @param {number} size - Size of the output PNG (width and height)
 * @returns {Promise<void>}
 */
async function convertSvgToPng(svgPath, outputPath, size) {
  try {
    // Create a canvas with the specified size
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Load the SVG image
    const image = await loadImage(svgPath);
    
    // Draw the image on the canvas
    ctx.drawImage(image, 0, 0, size, size);
    
    // Convert the canvas to a PNG buffer
    const buffer = canvas.toBuffer('image/png');
    
    // Write the buffer to a file
    fs.writeFileSync(outputPath, buffer);
    
    console.log(`Converted ${svgPath} to ${outputPath} (${size}x${size})`);
  } catch (error) {
    console.error(`Error converting ${svgPath} to PNG:`, error);
    throw error;
  }
}

/**
 * Main function to convert all icons
 */
async function convertIcons() {
  // Define source SVG path
  const svgPath = path.join(__dirname, '../public/logo.svg');
  
  // Create icons directory if it doesn't exist
  const iconsDir = path.join(__dirname, '../icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }
  
  // Generate various icon sizes
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  
  // Convert the icons
  try {
    for (const size of sizes) {
      const outputPath = path.join(iconsDir, `${size}x${size}.png`);
      await convertSvgToPng(svgPath, outputPath, size);
    }
    
    // Create a special icon for the system tray
    await convertSvgToPng(svgPath, path.join(iconsDir, 'tray-icon.png'), 24);
    
    console.log('All icons converted successfully');
  } catch (error) {
    console.error('Icon conversion failed:', error);
    process.exit(1);
  }
}

// Execute the conversion if this script is run directly
if (require.main === module) {
  convertIcons();
}

// Export for use in other scripts
module.exports = {
  convertSvgToPng,
  convertIcons
};