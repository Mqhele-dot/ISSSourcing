/**
 * Document Extractor Controller
 * 
 * Handles HTTP routes for document extraction functionality
 */
import type { Request, Response, Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import type {
  ProcessingOptions,
  ExtractedData,
  ExportFormat
} from '../services/document-extractor-service';
import {
  detectFileType,
  processFile,
  processBatch,
  exportData,
  FileType
} from '../services/document-extractor-service';
import { storage } from '../storage';
import type { AuthBundle } from '../modules/procurement/types';

// File filter for accepted file types (attach to multer — do not omit or uploads bypass MIME allowlist).
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'application/pdf',                                   // PDF
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
    'application/vnd.ms-excel.sheet.macroEnabled.12',   // XLSM
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

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: function (_req, _file, cb) {
      // Create temp directory if it doesn't exist
      const tmpDir = path.join(process.cwd(), "tmp");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      cb(null, tmpDir);
    },
    filename: function (_req, file, cb) {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  },
  fileFilter,
});

function cleanupUploads(files: Express.Multer.File | Express.Multer.File[] | undefined): void {
  const uploadedFiles = Array.isArray(files) ? files : files ? [files] : [];
  for (const file of uploadedFiles) {
    fs.rm(file.path, { force: true }, (error) => {
      if (error) console.error(`Error deleting temporary file: ${error.message}`);
    });
  }
}

/**
 * Register document extractor routes
 */
export function registerDocumentExtractorRoutes(router: Router, auth: AuthBundle): void {
  const extractorAccess = [auth.ensureAuthenticated, auth.ensureRole(['manager', 'admin'])];
  const databaseImportAccess = [auth.ensureAuthenticated, auth.ensureRole(['admin'])];
  // Process a single file
  router.post('/api/document-extractor/upload', ...extractorAccess, upload.single('file'), async (req: Request, res: Response) => {
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
      cleanupUploads(req.file);
      
      res.json({
        success: true,
        fileType,
        data: result
      });
    } catch (error) {
      cleanupUploads(req.file);
      console.error('Error processing file:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Process multiple files in batch
  router.post('/api/document-extractor/batch-upload', ...extractorAccess, upload.array('files', 10), async (req: Request, res: Response) => {
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
      cleanupUploads(files);
      
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      cleanupUploads(req.files as Express.Multer.File[] | undefined);
      console.error('Error processing batch:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
  
  // Process files from URLs
  router.post('/api/document-extractor/from-urls', ...extractorAccess, (_req: Request, res: Response) => {
    return res.status(410).json({
      success: false,
      code: 'REMOTE_DOCUMENT_EXTRACTION_DISABLED',
      error: 'Remote URL extraction is disabled. Upload a local file instead.',
    });
  });
  
  // Get supported formats
  router.get('/api/document-extractor/supported-formats', ...extractorAccess, (_req: Request, res: Response) => {
    res.json({
      supportedFileTypes: ['pdf', 'xlsx', 'xlsm', 'csv', 'jpg', 'jpeg', 'png', 'tiff'],
      supportedExportFormats: ['json', 'csv', 'excel', 'database'],
      supportedOcrLanguages: ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'jpn', 'kor', 'chi_sim', 'chi_tra']
    });
  });
  
  // Service health check
  router.get('/api/document-extractor/health', ...extractorAccess, (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      message: 'Document extractor service is running'
    });
  });
  
  // Export extracted data to various formats
  router.post('/api/document-extractor/export', ...extractorAccess, upload.none(), async (req: Request, res: Response) => {
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
      } else if (format === 'excel') {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
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
  router.post('/api/document-extractor/from-path', ...extractorAccess, (_req: Request, res: Response) => {
    return res.status(410).json({
      success: false,
      code: 'SERVER_PATH_EXTRACTION_DISABLED',
      error: 'Server-path extraction is disabled. Upload a local file instead.',
    });
  });
  
  // Import extracted data directly to database
  router.post('/api/document-extractor/import-to-database', ...databaseImportAccess, upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: 'No file uploaded' 
        });
      }
      
      if (!req.body.targetSchema) {
        cleanupUploads(req.file);
        return res.status(400).json({
          success: false,
          error: 'Target schema must be specified for database import'
        });
      }
      
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const targetSchema = String(req.body.targetSchema);
      if (!['inventory', 'suppliers', 'categories'].includes(targetSchema)) {
        cleanupUploads(req.file);
        return res.status(400).json({
          success: false,
          error: 'Target schema must be inventory, suppliers, or categories',
        });
      }
      
      const options: ProcessingOptions = {
        exportFormat: 'database',
        targetSchema,
        columnMapping: req.body.columnMapping ? JSON.parse(req.body.columnMapping) : undefined
      };
      
      const extractedData = await processFile(filePath, fileName, options);
      
      // Clean up the temporary file after processing
      cleanupUploads(req.file);
      
      const availableColumns = extractedData.columns ?? Object.keys((extractedData.data[0] as Record<string, unknown> | undefined) ?? {});
      const normalizedColumn = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const candidateFields = targetSchema === 'inventory'
        ? ['name', 'sku', 'price', 'quantity', 'description', 'categoryId', 'lowStockThreshold', 'location']
        : targetSchema === 'suppliers'
          ? ['name', 'contactName', 'email', 'phone', 'address', 'notes']
          : ['name', 'description'];
      const automaticMapping = Object.fromEntries(candidateFields.map((field) => [
        field,
        availableColumns.find((column) => normalizedColumn(column) === normalizedColumn(field)) ?? field,
      ]));
      options.columnMapping = { ...automaticMapping, ...(options.columnMapping ?? {}) };

      const validationErrors: Array<{ row: number; message: string }> = [];
      extractedData.data.forEach((row, index) => {
        const record = row as Record<string, unknown>;
        if (targetSchema === 'inventory' && (!record[options.columnMapping?.name || 'name'] || !record[options.columnMapping?.sku || 'sku'])) {
          validationErrors.push({ row: index + 2, message: 'Inventory rows require name and SKU.' });
        }
        if ((targetSchema === 'suppliers' || targetSchema === 'categories') && !record[options.columnMapping?.name || 'name']) {
          validationErrors.push({ row: index + 2, message: `${targetSchema === 'suppliers' ? 'Supplier' : 'Category'} rows require a name.` });
        }
        if (targetSchema === 'inventory') {
          const price = record[options.columnMapping?.price || 'price'];
          const quantity = record[options.columnMapping?.quantity || 'quantity'];
          if (price !== undefined && price !== null && price !== '' && !Number.isFinite(Number(price))) {
            validationErrors.push({ row: index + 2, message: 'Price must be a number.' });
          }
          if (quantity !== undefined && quantity !== null && quantity !== '' && !Number.isInteger(Number(quantity))) {
            validationErrors.push({ row: index + 2, message: 'Quantity must be a whole number.' });
          }
        }
      });

      if (String(req.body.previewOnly) === 'true') {
        return res.json({
          success: true,
          preview: true,
          fileName,
          fileType: extractedData.fileType,
          columns: extractedData.columns ?? Object.keys((extractedData.data[0] as Record<string, unknown> | undefined) ?? {}),
          totalRows: extractedData.data.length,
          sampleRows: extractedData.data.slice(0, 20),
          validationErrors: validationErrors.slice(0, 100),
        });
      }
      if (validationErrors.length > 0) {
        return res.status(400).json({ success: false, error: 'Import validation failed. Preview the file and correct required mappings.', validationErrors: validationErrors.slice(0, 100) });
      }

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
      cleanupUploads(req.file);
      console.error('Error importing to database:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'An unknown error occurred' 
      });
    }
  });
}
