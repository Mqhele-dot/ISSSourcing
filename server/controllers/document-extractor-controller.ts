/**
 * Document Extractor Controller
 * 
 * Handles HTTP routes for document extraction functionality
 */
import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import {
  detectFileType,
  processFile,
  processBatch,
  processFromUrls,
  exportData,
  FileType,
  ProcessingOptions,
  ExtractedData
} from '../services/document-extractor-service';
import { storage } from '../storage';

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: function(_req, _file, cb) {
      // Create temp directory if it doesn't exist
      const tmpDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      cb(null, tmpDir);
    },
    filename: function(_req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  }
});

// File filter for accepted file types
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'application/pdf',                                   // PDF
    'application/vnd.ms-excel',                          // XLS
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
    'text/csv',                                          // CSV
    'application/csv',                                   // CSV (alternate mime type)
    'image/jpeg',                                        // JPEG
    'image/png',                                         // PNG
    'image/tiff'                                         // TIFF
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, Excel, CSV, and common image formats are allowed.'));
  }
};

/**
 * Register document extractor routes
 */
export function registerDocumentExtractorRoutes(router: Router): void {
  // Process a single file
  router.post('/api/document-extractor/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: 'No file uploaded' 
        });
      }
      
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const options: ProcessingOptions = req.body.options ? JSON.parse(req.body.options) : {};
      
      const fileType = await detectFileType(filePath);
      const result = await processFile(filePath, fileName, options);
      
      // Clean up the temporary file after processing
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting temporary file: ${err}`);
      });
      
      res.json({
        success: true,
        fileType,
        data: result
      });
    } catch (error) {
      console.error('Error processing file:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Process multiple files in batch
  router.post('/api/document-extractor/batch-upload', upload.array('files', 10), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'No files uploaded' 
        });
      }
      
      const options: ProcessingOptions = req.body.options ? JSON.parse(req.body.options) : {};
      
      const filePaths = files.map(file => ({
        path: file.path,
        originalName: file.originalname
      }));
      
      const result = await processBatch(filePaths, options);
      
      // Clean up the temporary files after processing
      filePaths.forEach(file => {
        fs.unlink(file.path, (err) => {
          if (err) console.error(`Error deleting temporary file: ${err}`);
        });
      });
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error processing batch:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Process files from URLs
  router.post('/api/document-extractor/from-urls', async (req: Request, res: Response) => {
    try {
      const { urls, options } = req.body;
      
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'No URLs provided or invalid URL format' 
        });
      }
      
      const result = await processFromUrls(urls, options || {});
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error processing URLs:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Get supported formats
  router.get('/api/document-extractor/supported-formats', (_req: Request, res: Response) => {
    res.json({
      supportedFileTypes: ['pdf', 'excel', 'csv', 'jpg', 'jpeg', 'png', 'tiff'],
      supportedExportFormats: ['json', 'csv', 'database'],
      supportedOcrLanguages: ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'jpn', 'kor', 'chi_sim', 'chi_tra']
    });
  });
  
  // Service health check
  router.get('/api/document-extractor/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      message: 'Document extractor service is running'
    });
  });
  
  // Export extracted data to various formats
  router.post('/api/document-extractor/export', upload.none(), async (req: Request, res: Response) => {
    try {
      if (!req.body.data) {
        return res.status(400).json({ 
          success: false, 
          error: 'No data provided for export' 
        });
      }
      
      let data: ExtractedData;
      try {
        data = JSON.parse(req.body.data);
      } catch (error) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid data format. Expected JSON data.' 
        });
      }
      
      const format = (req.body.format || 'json') as ExportFormat;
      const fileName = req.body.fileName || `export-${new Date().toISOString().slice(0, 10)}`;
      
      const exportedData = await exportData(data, format, fileName);
      
      // Set appropriate headers based on export format
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.json"`);
      } else if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.csv"`);
      }
      
      res.send(exportedData);
    } catch (error) {
      console.error('Error exporting data:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Process a document from local filesystem path
  router.post('/api/document-extractor/from-path', async (req: Request, res: Response) => {
    try {
      const { filePath, fileName, options } = req.body;
      
      if (!filePath) {
        return res.status(400).json({ 
          success: false, 
          error: 'No file path provided' 
        });
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ 
          success: false, 
          error: 'File not found at the provided path' 
        });
      }
      
      const result = await processFile(
        filePath,
        fileName || path.basename(filePath),
        options || {}
      );
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error processing file from path:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Import extracted data directly to database
  router.post('/api/document-extractor/import-to-database', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: 'No file uploaded' 
        });
      }
      
      if (!req.body.targetSchema) {
        return res.status(400).json({
          success: false,
          error: 'Target schema must be specified for database import'
        });
      }
      
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const targetSchema = req.body.targetSchema;
      
      const options: ProcessingOptions = {
        exportFormat: 'database',
        targetSchema,
        columnMapping: req.body.columnMapping ? JSON.parse(req.body.columnMapping) : undefined
      };
      
      const extractedData = await processFile(filePath, fileName, options);
      
      // Clean up the temporary file after processing
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting temporary file: ${err}`);
      });
      
      // Handle database import based on the target schema
      let recordsImported = 0;
      
      if (targetSchema === 'inventory' && extractedData.data.length > 0) {
        // Map extracted data to inventory items schema
        const items = extractedData.data.map(item => ({
          name: item[options.columnMapping?.name || 'name'],
          sku: item[options.columnMapping?.sku || 'sku'],
          price: parseFloat(item[options.columnMapping?.price || 'price']),
          quantity: parseInt(item[options.columnMapping?.quantity || 'quantity'], 10),
          description: item[options.columnMapping?.description || 'description'] || null,
          status: 'active'
        }));
        
        // Import items to inventory
        for (const item of items) {
          if (item.name && item.sku) {
            await storage.createInventoryItem(item);
            recordsImported++;
          }
        }
      } else if (targetSchema === 'suppliers' && extractedData.data.length > 0) {
        // Map extracted data to suppliers schema
        const suppliers = extractedData.data.map(supplier => ({
          name: supplier[options.columnMapping?.name || 'name'],
          contactName: supplier[options.columnMapping?.contactName || 'contactName'] || null,
          email: supplier[options.columnMapping?.email || 'email'] || null,
          phone: supplier[options.columnMapping?.phone || 'phone'] || null,
          address: supplier[options.columnMapping?.address || 'address'] || null,
          notes: supplier[options.columnMapping?.notes || 'notes'] || null
        }));
        
        // Import suppliers
        for (const supplier of suppliers) {
          if (supplier.name) {
            await storage.createSupplier(supplier);
            recordsImported++;
          }
        }
      } else if (targetSchema === 'categories' && extractedData.data.length > 0) {
        // Map extracted data to categories schema
        const categories = extractedData.data.map(category => ({
          name: category[options.columnMapping?.name || 'name'],
          description: category[options.columnMapping?.description || 'description'] || null
        }));
        
        // Import categories
        for (const category of categories) {
          if (category.name) {
            await storage.createCategory(category);
            recordsImported++;
          }
        }
      }
      
      res.json({
        success: true,
        message: `Successfully imported ${recordsImported} records to ${targetSchema}`,
        recordsImported
      });
    } catch (error) {
      console.error('Error importing to database:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
}