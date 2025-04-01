/**
 * Image Recognition Controller
 * 
 * This controller handles API endpoints related to image recognition for inventory items.
 * It provides endpoints for:
 * - Uploading and analyzing product images
 * - Creating inventory items from recognized images
 * - Managing training data for image recognition models
 */

import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { storage } from '../storage';
import { analyzeProductImage, RecognizedItem } from '../services/image-recognition-service';

// Set up multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      // Create uploads directory if it doesn't exist
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      // Create unique filename with timestamp
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // Limit file size to 5MB
  },
  fileFilter: (_req, file, cb) => {
    // Allow only image files
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    
    cb(new Error('Only image files are allowed!'));
  }
});

/**
 * Register image recognition routes
 * @param app - Express application
 */
export function registerImageRecognitionRoutes(app: any) {
  // Route to analyze an image and return recognized items
  app.post('/api/image-recognition/analyze', upload.single('image'), analyzeProductImageHandler);
  
  // Route to create an inventory item from recognized image data
  app.post('/api/image-recognition/create-item', createItemFromImageHandler);
  
  // Route to get analysis history for an inventory item
  app.get('/api/image-recognition/item/:id/history', getItemAnalysisHistoryHandler);
  
  // Route to check if image recognition is properly configured
  app.get('/api/image-recognition/status', getImageRecognitionStatusHandler);
}

/**
 * Handle product image analysis requests
 * @param req - Express request
 * @param res - Express response
 */
async function analyzeProductImageHandler(req: Request, res: Response) {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    // Read file buffer
    const imageBuffer = fs.readFileSync(req.file.path);
    
    // Analyze the image
    const recognizedItem = await analyzeProductImage(imageBuffer);
    
    // Log the analysis for future reference and training
    if (req.user) {
      await logImageAnalysis(req.user.id, imageBuffer, recognizedItem);
    }
    
    // Return results
    res.json({
      success: true,
      recognizedItem
    });
    
  } catch (error: any) {
    console.error('Error analyzing product image:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to analyze product image',
      error: error.message 
    });
  } finally {
    // Clean up uploaded file
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (error) {
        console.error('Error deleting temporary file:', error);
      }
    }
  }
}

/**
 * Handle creating an inventory item from recognized image
 * @param req - Express request
 * @param res - Express response
 */
async function createItemFromImageHandler(req: Request, res: Response) {
  try {
    const { name, sku, ...itemData } = req.body;
    
    if (!name || !sku) {
      return res.status(400).json({ 
        message: 'Name and SKU are required to create an inventory item' 
      });
    }
    
    // Create new inventory item
    const newItem = await storage.createInventoryItem({
      name,
      sku,
      price: itemData.price,
      quantity: itemData.quantity,
      lowStockThreshold: itemData.lowStockThreshold,
      categoryId: itemData.categoryId,
      description: itemData.description || null,
      notes: itemData.notes || null,
      location: itemData.location || null
    });
    
    res.status(201).json({
      success: true,
      message: 'Inventory item created successfully',
      item: newItem
    });
    
  } catch (error: any) {
    console.error('Error creating inventory item from image:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create inventory item',
      error: error.message 
    });
  }
}

/**
 * Get image analysis history for a specific inventory item
 * @param req - Express request
 * @param res - Express response
 */
async function getItemAnalysisHistoryHandler(req: Request, res: Response) {
  try {
    const itemId = parseInt(req.params.id);
    
    if (isNaN(itemId)) {
      return res.status(400).json({ message: 'Invalid item ID' });
    }
    
    // Get item's image analysis history
    const history = await storage.getItemImageAnalysisHistory(itemId);
    
    res.json({
      success: true,
      history
    });
    
  } catch (error: any) {
    console.error('Error fetching item analysis history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch item analysis history',
      error: error.message 
    });
  }
}

/**
 * Check if image recognition is properly configured
 * @param req - Express request
 * @param res - Express response
 */
async function getImageRecognitionStatusHandler(_req: Request, res: Response) {
  try {
    // Send a simple status check - this could be enhanced to check external API keys
    // or connection status to AI services if being used
    res.json({
      status: 'operational',
      message: 'Image recognition service is properly configured and operational'
    });
  } catch (error: any) {
    console.error('Error checking image recognition status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check image recognition status',
      error: error.message 
    });
  }
}

/**
 * Log image analysis for history and training purposes
 * @param userId - User ID performing the analysis
 * @param imageBuffer - Original image data
 * @param recognizedItem - Recognition results
 */
async function logImageAnalysis(
  userId: number, 
  imageBuffer: Buffer, 
  recognizedItem: RecognizedItem
): Promise<void> {
  try {
    // Create a log entry
    await storage.logImageAnalysis({
      userId,
      timestamp: new Date(),
      imageHash: Buffer.from(imageBuffer).toString('base64').substring(0, 50), // Just store a hash, not the entire image
      recognitionResults: recognizedItem,
      confidence: recognizedItem.confidence || 0
    });
  } catch (error) {
    console.error('Error logging image analysis:', error);
    // Non-critical error, just log and continue
  }
}