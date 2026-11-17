import React, { useState, useCallback } from 'react';
import { useLocation } from "wouter";
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useMutation } from '@tanstack/react-query';
import { Loader2, FileText, Upload, Database, Check, ChevronDown, X, Wrench } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DocumentExtractorPageIntro } from '@/pages/document-extractor/document-extractor-page-intro';
import { APP_ROUTES, DOCUMENT_EXTRACTOR_SECTION_SLUGS, asSectionSlug } from "@/lib/routes/app-routes";
import { buildRequestHeaders, requestJson } from "@/lib/queryClient";

async function postFormData(url: string, formData: FormData) {
  const headers = await buildRequestHeaders("POST");
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(payload?.error ?? payload?.message ?? `Request failed (${response.status})`);
  }

  return response.json();
}

type SupportedFormats = {
  supportedFileTypes: string[];
  supportedExportFormats: string[];
  supportedOcrLanguages: string[];
};

type ExtractionResult = {
  success: boolean;
  fileType: string;
  data: {
    fileType: string;
    fileName: string;
    extractionDate: string;
    pages?: number;
    rows?: number;
    columns?: string[];
    data: any[];
    warnings?: string[];
    processingTimeMs?: number;
    metadata?: Record<string, any>;
  };
  error?: string;
};

type BatchExtractionResult = {
  success: boolean;
  data: {
    totalFiles: number;
    successfulFiles: number;
    failedFiles: number;
    totalRecords: number;
    results: {
      fileName: string;
      success: boolean;
      records?: number;
      error?: string;
      data?: any;
    }[];
  };
  error?: string;
};

type ProcessingOptions = {
  useOcr?: boolean;
  ocrLanguage?: string;
  headerRow?: boolean;
  sheetIndex?: number;
  exportFormat?: string;
  targetSchema?: string;
  columnMapping?: Record<string, string>;
};

type ImportPreview = {
  success: boolean;
  preview: true;
  fileName: string;
  fileType: string;
  columns: string[];
  totalRows: number;
  sampleRows: Array<Record<string, unknown>>;
  validationErrors: Array<{ row: number; message: string }>;
};

const DocumentExtractorPage: React.FC = () => {
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const activeMode = asSectionSlug(location.split("/")[3], DOCUMENT_EXTRACTOR_SECTION_SLUGS, "single");
  const reportRejectedFiles = useCallback((rejections: FileRejection[]) => {
    if (!rejections.length) return;
    const message = rejections.map(({ file, errors }) => `${file.name}: ${errors.map((error) => error.message).join(", ")}`).join("; ");
    toast({ title: 'File rejected', description: message, variant: 'destructive' });
  }, [toast]);

  // State for formats and options
  const [formats, setFormats] = useState<SupportedFormats | null>(null);
  const [options, setOptions] = useState<ProcessingOptions>({
    useOcr: false,
    ocrLanguage: 'eng',
    headerRow: true,
    sheetIndex: 0,
    exportFormat: 'json',
  });

  // State for extraction results
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [batchExtractionResult, setBatchExtractionResult] = useState<BatchExtractionResult | null>(null);
  const [targetSchema, setTargetSchema] = useState<string>('inventory');
  const [resultTab, setResultTab] = useState('data');

  // Column mapping for database import
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  // Fetch supported formats when component mounts
  React.useEffect(() => {
    requestJson<SupportedFormats>('GET', '/api/document-extractor/supported-formats')
      .then(data => setFormats(data))
      .catch(err => console.error('Error fetching supported formats:', err));
  }, []);

  // Single file upload mutation
  const singleFileUploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      return postFormData('/api/document-extractor/upload', formData);
    },
    onSuccess: (data: ExtractionResult) => {
      setExtractionResult(data);
      toast({
        title: 'File processed successfully!',
        description: `Extracted ${data.data.data.length} records from ${data.data.fileName}`,
        variant: 'default',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error processing file',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Batch files upload mutation
  const batchFilesUploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      return postFormData('/api/document-extractor/batch-upload', formData);
    },
    onSuccess: (data: BatchExtractionResult) => {
      setBatchExtractionResult(data);
      toast({
        title: 'Batch processing completed!',
        description: `Successfully processed ${data.data.successfulFiles} of ${data.data.totalFiles} files with ${data.data.totalRecords} total records`,
        variant: 'default',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error processing batch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Database import mutation
  const databaseImportMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      return postFormData('/api/document-extractor/import-to-database', formData);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error importing to database',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const importPreviewMutation = useMutation({
    mutationFn: async (formData: FormData) => postFormData('/api/document-extractor/import-to-database', formData) as Promise<ImportPreview>,
    onSuccess: (data) => {
      setImportPreview(data);
      setColumnMapping((current) => {
        const next = { ...current };
        for (const field of getDefaultColumnMapping()) {
          if (next[field]) continue;
          const match = data.columns.find((column) => column.toLowerCase().replaceAll(/[^a-z0-9]/g, '') === field.toLowerCase());
          if (match) next[field] = match;
        }
        return next;
      });
      toast({ title: 'Import preview ready', description: `${data.totalRows} row(s) found in ${data.fileName}. Review mappings before importing.` });
    },
    onError: (error: Error) => toast({ title: 'Could not preview import', description: error.message, variant: 'destructive' }),
  });

  // Dropzone for single file
  const onSingleFileDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('options', JSON.stringify(options));
      singleFileUploadMutation.mutate(formData);
    }
  }, [options, singleFileUploadMutation]);

  const { getRootProps: getSingleFileRootProps, getInputProps: getSingleFileInputProps } = useDropzone({
    onDrop: onSingleFileDrop,
    onDropRejected: reportRejectedFiles,
    multiple: false,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
      'text/csv': ['.csv'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/tiff': ['.tiff', '.tif']
    }
  });

  // Dropzone for batch files
  const onBatchFilesDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const formData = new FormData();
      acceptedFiles.forEach(file => {
        formData.append('files', file);
      });
      formData.append('options', JSON.stringify(options));
      batchFilesUploadMutation.mutate(formData);
    }
  }, [options, batchFilesUploadMutation]);

  const { getRootProps: getBatchFilesRootProps, getInputProps: getBatchFilesInputProps } = useDropzone({
    onDrop: onBatchFilesDrop,
    onDropRejected: reportRejectedFiles,
    multiple: true,
    maxFiles: 10,
    maxSize: 10 * 1024 * 1024,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
      'text/csv': ['.csv'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/tiff': ['.tiff', '.tif']
    }
  });

  // Handle database import (stable callback for dropzone)
  const handleDatabaseImport = useCallback((file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('targetSchema', targetSchema);
    formData.append('columnMapping', JSON.stringify(columnMapping));

    databaseImportMutation.mutate(formData, {
      onSuccess: (data) => {
        toast({
          title: 'Database Import Successful',
          description: `Imported ${data.recordsImported} records to ${targetSchema}`,
          variant: 'default',
        });
      }
    });
  }, [targetSchema, columnMapping, databaseImportMutation, toast]);

  // Dropzone for database import
  const onDatabaseImportDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setImportFile(file);
      setImportPreview(null);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('targetSchema', targetSchema);
      formData.append('columnMapping', JSON.stringify(columnMapping));
      formData.append('previewOnly', 'true');
      importPreviewMutation.mutate(formData);
    }
  }, [columnMapping, importPreviewMutation, targetSchema]);

  const { getRootProps: getDatabaseImportRootProps, getInputProps: getDatabaseImportInputProps } = useDropzone({
    onDrop: onDatabaseImportDrop,
    onDropRejected: reportRejectedFiles,
    multiple: false,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
      'text/csv': ['.csv'],
    }
  });

  // Handle column mapping change
  const handleColumnMappingChange = (key: string, value: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  // Default column mappings based on target schema
  const getDefaultColumnMapping = () => {
    switch (targetSchema) {
      case 'inventory':
        return ['name', 'sku', 'price', 'quantity', 'description', 'categoryId', 'lowStockThreshold', 'location'];
      case 'suppliers':
        return ['name', 'contactName', 'email', 'phone', 'address', 'notes'];
      case 'categories':
        return ['name', 'description'];
      default:
        return [];
    }
  };

  // Handle JSON export
  const handleExportJson = () => {
    if (!extractionResult) return;
    
    const dataStr = JSON.stringify(extractionResult.data.data, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;
    
    const exportFileDefaultName = `export-${new Date().toISOString().slice(0, 10)}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // Handle CSV export
  const handleExportCsv = async () => {
    if (!extractionResult) return;
    
    try {
      const formData = new FormData();
      formData.append('data', JSON.stringify(extractionResult.data));
      formData.append('format', 'csv');
      
      const headers = await buildRequestHeaders("POST");
      const response = await fetch('/api/document-extractor/export', {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Export failed');
      
      const responseBlob = await response.blob();
      const url = window.URL.createObjectURL(responseBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: 'Export Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto py-8" data-testid="document-extractor-page">
      <div className="flex flex-col space-y-6">
        <DocumentExtractorPageIntro />

        <Tabs
          value={activeMode}
          onValueChange={(value) => navigate(APP_ROUTES.admin.documentExtractorMode(value as typeof activeMode))}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="single">Single File</TabsTrigger>
            <TabsTrigger value="batch">Batch Processing</TabsTrigger>
            <TabsTrigger value="import">Database Import</TabsTrigger>
            <TabsTrigger value="options">Options</TabsTrigger>
          </TabsList>

          {/* Single File Upload Tab */}
          <TabsContent value="single" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Upload Single File</CardTitle>
                <CardDescription>
                  Upload a PDF, Excel, CSV, or image file to extract its content.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div 
                  {...getSingleFileRootProps()} 
                  className="border-2 border-dashed rounded-md border-gray-300 p-10 text-center hover:border-primary cursor-pointer"
                >
                  <input aria-label="Choose one document to extract" {...getSingleFileInputProps()} />
                  {singleFileUploadMutation.isPending ? (
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                      <p className="mt-2">Processing file...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center">
                      <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                      <p className="text-lg font-medium">Drag & drop a file here, or click to select</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Supported formats: {formats?.supportedFileTypes.join(', ')}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {extractionResult && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-center">
                    <CardTitle>Extraction Results</CardTitle>
                    <div className="flex space-x-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="outline" onClick={handleExportJson}>
                              <FileText className="h-4 w-4 mr-2" />
                              JSON
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Export as JSON</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="outline" onClick={handleExportCsv}>
                              <FileText className="h-4 w-4 mr-2" />
                              CSV
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Export as CSV</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                  <CardDescription>
                    {extractionResult.data.fileName} - {extractionResult.data.rows || extractionResult.data.data.length} records
                    {extractionResult.data.processingTimeMs && (
                      <span className="ml-2 text-muted-foreground text-xs">
                        (processed in {(extractionResult.data.processingTimeMs / 1000).toFixed(2)}s)
                      </span>
                    )}
                  </CardDescription>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge variant="outline">{extractionResult.fileType}</Badge>
                    {extractionResult.data.pages && (
                      <Badge variant="outline">{extractionResult.data.pages} pages</Badge>
                    )}
                    {extractionResult.data.warnings && extractionResult.data.warnings.length > 0 && (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-800 hover:bg-yellow-100">
                        {extractionResult.data.warnings.length} warnings
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs value={resultTab} onValueChange={setResultTab}>
                    <TabsList className="mb-4">
                      <TabsTrigger value="data">Data</TabsTrigger>
                      <TabsTrigger value="metadata">Metadata</TabsTrigger>
                      {extractionResult.data.warnings && extractionResult.data.warnings.length > 0 && (
                        <TabsTrigger value="warnings">Warnings</TabsTrigger>
                      )}
                    </TabsList>

                    <TabsContent value="data">
                      <div className="rounded-md border overflow-hidden">
                        <div className="max-h-96 overflow-auto">
                          {extractionResult.data.data.length > 0 ? (
                            Array.isArray(extractionResult.data.data[0]) ? (
                              // Handle array of arrays
                              <Table>
                                <TableBody>
                                  {extractionResult.data.data.map((row, rowIndex) => (
                                    <TableRow key={rowIndex}>
                                      {Array.isArray(row) && row.map((cell, cellIndex) => (
                                        <TableCell key={cellIndex}>{String(cell)}</TableCell>
                                      ))}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            ) : (
                              // Handle objects
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    {extractionResult.data.columns ? (
                                      extractionResult.data.columns.map((column, index) => (
                                        <TableHead key={index}>{column}</TableHead>
                                      ))
                                    ) : (
                                      Object.keys(extractionResult.data.data[0]).map((key, index) => (
                                        <TableHead key={index}>{key}</TableHead>
                                      ))
                                    )}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {extractionResult.data.data.map((row, rowIndex) => (
                                    <TableRow key={rowIndex}>
                                      {Object.entries(row).map(([key, value], cellIndex) => (
                                        <TableCell key={cellIndex}>
                                          {typeof value === 'object' && value !== null
                                            ? JSON.stringify(value)
                                            : String(value)}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )
                          ) : (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              No structured data found
                            </div>
                          )}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="metadata">
                      <div className="space-y-4">
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Property</TableHead>
                                <TableHead>Value</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              <TableRow>
                                <TableCell>File Name</TableCell>
                                <TableCell>{extractionResult.data.fileName}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell>File Type</TableCell>
                                <TableCell>{extractionResult.data.fileType}</TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell>Extraction Date</TableCell>
                                <TableCell>{new Date(extractionResult.data.extractionDate).toLocaleString()}</TableCell>
                              </TableRow>
                              {extractionResult.data.pages && (
                                <TableRow>
                                  <TableCell>Pages</TableCell>
                                  <TableCell>{extractionResult.data.pages}</TableCell>
                                </TableRow>
                              )}
                              {extractionResult.data.rows && (
                                <TableRow>
                                  <TableCell>Rows</TableCell>
                                  <TableCell>{extractionResult.data.rows}</TableCell>
                                </TableRow>
                              )}
                              <TableRow>
                                <TableCell>Processing Time</TableCell>
                                <TableCell>
                                  {extractionResult.data.processingTimeMs 
                                    ? `${(extractionResult.data.processingTimeMs / 1000).toFixed(2)} seconds` 
                                    : 'Unknown'}
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </Table>
                        </div>

                        {extractionResult.data.metadata && Object.keys(extractionResult.data.metadata).length > 0 && (
                          <div>
                            <h3 className="text-md font-medium mb-2">Document Metadata</h3>
                            <div className="rounded-md border overflow-hidden">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Property</TableHead>
                                    <TableHead>Value</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {Object.entries(extractionResult.data.metadata).map(([key, value], index) => (
                                    <TableRow key={index}>
                                      <TableCell>{key}</TableCell>
                                      <TableCell>
                                        {typeof value === 'object' && value !== null
                                          ? JSON.stringify(value)
                                          : String(value)}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {extractionResult.data.warnings && extractionResult.data.warnings.length > 0 && (
                      <TabsContent value="warnings">
                        <div className="rounded-md border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Warning</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {extractionResult.data.warnings.map((warning, index) => (
                                <TableRow key={index}>
                                  <TableCell>{index + 1}</TableCell>
                                  <TableCell>{warning}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TabsContent>
                    )}
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Batch Processing Tab */}
          <TabsContent value="batch" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Batch File Processing</CardTitle>
                <CardDescription>
                  Upload multiple files to process them in a batch.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div 
                  {...getBatchFilesRootProps()} 
                  className="border-2 border-dashed rounded-md border-gray-300 p-10 text-center hover:border-primary cursor-pointer"
                >
                  <input aria-label="Choose up to ten documents for batch extraction" {...getBatchFilesInputProps()} />
                  {batchFilesUploadMutation.isPending ? (
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 className="h-10 w-10 animate-spin text-primary" />
                      <p className="mt-2">Processing files...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center">
                      <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                      <p className="text-lg font-medium">Drag & drop files here, or click to select</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        You can select multiple files (max 10) of the same or different formats.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {batchExtractionResult && (
              <Card>
                <CardHeader>
                  <CardTitle>Batch Processing Results</CardTitle>
                  <CardDescription>
                    Processed {batchExtractionResult.data.totalFiles} files with {batchExtractionResult.data.totalRecords} total records.
                  </CardDescription>
                  <div className="flex space-x-2 mt-2">
                    <Badge variant="outline" className="bg-green-50 text-green-800">
                      {batchExtractionResult.data.successfulFiles} successful
                    </Badge>
                    {batchExtractionResult.data.failedFiles > 0 && (
                      <Badge variant="outline" className="bg-red-50 text-red-800">
                        {batchExtractionResult.data.failedFiles} failed
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="w-full">
                    {batchExtractionResult.data.results.map((result, index) => (
                      <AccordionItem key={index} value={`item-${index}`}>
                        <AccordionTrigger className="hover:no-underline group">
                          <div className="flex items-center space-x-2 text-left">
                            {result.success ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <X className="h-4 w-4 text-red-600" />
                            )}
                            <span>{result.fileName}</span>
                            {result.success && result.records && (
                              <Badge variant="outline" className="ml-2">
                                {result.records} records
                              </Badge>
                            )}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          {result.success ? (
                            <div className="space-y-2">
                              <div className="rounded-md border overflow-hidden">
                                <div className="max-h-60 overflow-auto">
                                  {result.data && result.data.data && result.data.data.length > 0 ? (
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          {result.data.columns ? (
                                            result.data.columns.map((column: string, colIndex: number) => (
                                              <TableHead key={colIndex}>{column}</TableHead>
                                            ))
                                          ) : (
                                            Object.keys(result.data.data[0]).map((key, colIndex) => (
                                              <TableHead key={colIndex}>{key}</TableHead>
                                            ))
                                          )}
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {result.data.data.slice(0, 5).map((row: Record<string, unknown>, rowIndex: number) => (
                                          <TableRow key={rowIndex}>
                                            {Object.entries(row).map(([key, value], cellIndex) => (
                                              <TableCell key={cellIndex}>
                                                {typeof value === 'object' && value !== null
                                                  ? JSON.stringify(value)
                                                  : String(value)}
                                              </TableCell>
                                            ))}
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  ) : (
                                    <div className="p-4 text-center text-sm text-muted-foreground">
                                      No structured data found
                                    </div>
                                  )}
                                </div>
                              </div>
                              {result.data && result.data.data && result.data.data.length > 5 && (
                                <p className="text-sm text-muted-foreground">
                                  Showing 5 of {result.data.data.length} records
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="p-2 rounded bg-red-50 text-red-800">
                              {result.error}
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Database Import Tab */}
          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Import to Database</CardTitle>
                <CardDescription>
                  Import data from Excel or CSV files directly into the database.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="target-schema">Target Schema</Label>
                        <Select 
                          value={targetSchema} 
                          onValueChange={setTargetSchema}
                        >
                          <SelectTrigger id="target-schema">
                            <SelectValue placeholder="Select a schema" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="inventory">Inventory Items</SelectItem>
                              <SelectItem value="suppliers">Suppliers</SelectItem>
                              <SelectItem value="categories">Categories</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="w-full" type="button">
                            <Wrench className="h-4 w-4 mr-2" />
                            Configure Column Mapping
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                          <DialogHeader>
                            <DialogTitle>Column Mapping</DialogTitle>
                            <DialogDescription>
                              Map columns from your file to database fields.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <p className="text-sm text-muted-foreground mb-2">
                              Enter the column names from your file that correspond to each database field.
                            </p>
                            {getDefaultColumnMapping().map((field) => (
                              <div key={field} className="grid grid-cols-2 gap-2 items-center">
                                <Label htmlFor={`field-${field}`} className="text-right">
                                  {field}:
                                </Label>
                                <Input
                                  id={`field-${field}`}
                                  value={columnMapping[field] || ''}
                                  onChange={(e) => handleColumnMappingChange(field, e.target.value)}
                                  placeholder={field}
                                />
                              </div>
                            ))}
                          </div>
                          <DialogFooter>
                            <Button type="button">Save Mapping</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    <div 
                      {...getDatabaseImportRootProps()} 
                      className="border-2 border-dashed rounded-md border-gray-300 p-8 text-center hover:border-primary cursor-pointer"
                    >
                      <input aria-label="Choose one Excel or CSV file to preview for database import" {...getDatabaseImportInputProps()} />
                      {databaseImportMutation.isPending || importPreviewMutation.isPending ? (
                        <div className="flex flex-col items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="mt-2">{databaseImportMutation.isPending ? 'Importing data...' : 'Reading workbook preview...'}</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center">
                          <Database className="h-8 w-8 text-muted-foreground mb-2" />
                          <p className="text-md font-medium">Drag & drop a file here, or click to select</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Excel (.xlsx/.xlsm) and CSV formats supported
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {importPreview ? (
                    <Card data-testid="document-import-preview">
                      <CardHeader>
                        <CardTitle className="text-base">Review before import</CardTitle>
                        <CardDescription>{importPreview.fileName} · {importPreview.totalRows} rows · showing up to 20</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {importPreview.validationErrors.length > 0 ? (
                          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                            {importPreview.validationErrors.length} row validation issue(s) found. Update the column mapping and upload the preview again.
                          </div>
                        ) : null}
                        <div className="max-h-72 overflow-auto rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>{importPreview.columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow>
                            </TableHeader>
                            <TableBody>
                              {importPreview.sampleRows.map((row, rowIndex) => (
                                <TableRow key={rowIndex}>{importPreview.columns.map((column) => <TableCell key={column}>{String(row[column] ?? '')}</TableCell>)}</TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" disabled={!importFile || importPreview.validationErrors.length > 0 || databaseImportMutation.isPending}>Import {importPreview.totalRows} rows</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Import validated workbook rows?</AlertDialogTitle>
                              <AlertDialogDescription>This creates records in {targetSchema}. Duplicate and database constraints remain authoritative.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => importFile && handleDatabaseImport(importFile)}>Confirm import</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </CardContent>
                    </Card>
                  ) : null}

                  <div className="bg-muted rounded-md p-4">
                    <h3 className="text-sm font-medium mb-2">Import Guidelines</h3>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                      <li>Your file should have a header row with column names.</li>
                      <li>For inventory items, SKU and name fields are required.</li>
                      <li>For suppliers, only the name field is required.</li>
                      <li>Configure column mapping if your file's column names are different from the database fields.</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Options Tab */}
          <TabsContent value="options" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Processing Options</CardTitle>
                <CardDescription>
                  Configure how documents are processed and data is extracted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">OCR Options</h3>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="use-ocr"
                        checked={options.useOcr}
                        onCheckedChange={(checked) => setOptions({ ...options, useOcr: checked })}
                      />
                      <Label htmlFor="use-ocr">Enable OCR for PDFs and images</Label>
                    </div>
                    {options.useOcr && (
                      <div className="space-y-2 pl-6">
                        <Label htmlFor="ocr-language">OCR Language</Label>
                        <Select 
                          value={options.ocrLanguage || 'eng'} 
                          onValueChange={(value) => setOptions({ ...options, ocrLanguage: value })}
                        >
                          <SelectTrigger id="ocr-language">
                            <SelectValue placeholder="Select language" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eng">English</SelectItem>
                            <SelectItem value="spa">Spanish</SelectItem>
                            <SelectItem value="fra">French</SelectItem>
                            <SelectItem value="deu">German</SelectItem>
                            <SelectItem value="jpn">Japanese</SelectItem>
                            <SelectItem value="chi_sim">Chinese (Simplified)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Excel/CSV Options</h3>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="header-row"
                        checked={options.headerRow}
                        onCheckedChange={(checked) => setOptions({ ...options, headerRow: checked })}
                      />
                      <Label htmlFor="header-row">First row contains headers</Label>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sheet-index">Sheet Index (for Excel files)</Label>
                      <Input
                        id="sheet-index"
                        type="number"
                        min="0"
                        value={options.sheetIndex}
                        onChange={(e) => setOptions({ ...options, sheetIndex: parseInt(e.target.value) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        The index of the sheet to process (0 = first sheet)
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-medium">Export Options</h3>
                    <div className="space-y-2">
                      <Label htmlFor="export-format">Default Export Format</Label>
                      <Select 
                        value={options.exportFormat || 'json'} 
                        onValueChange={(value) => setOptions({ ...options, exportFormat: value })}
                      >
                        <SelectTrigger id="export-format">
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="json">JSON</SelectItem>
                          <SelectItem value="csv">CSV</SelectItem>
                          <SelectItem value="database">Database</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button variant="outline" onClick={() => setOptions({
                  useOcr: false,
                  ocrLanguage: 'eng',
                  headerRow: true,
                  sheetIndex: 0,
                  exportFormat: 'json'
                })}>
                  Reset to Defaults
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default DocumentExtractorPage;
