import * as fs from 'fs';
import * as path from 'path';

// Node environment doesn't have the DOM, so we need to polyfill DOMMatrix
class DOMMatrixPolyfill {
  a: number = 1;
  b: number = 0;
  c: number = 0;
  d: number = 1;
  e: number = 0;
  f: number = 0;

  constructor(transform?: string) {
    // Simple initialization for our needs
    if (transform) {
      const values = transform.match(/[+-]?\d+(\.\d+)?/g);
      if (values && values.length >= 6) {
        this.a = parseFloat(values[0]);
        this.b = parseFloat(values[1]);
        this.c = parseFloat(values[2]);
        this.d = parseFloat(values[3]);
        this.e = parseFloat(values[4]);
        this.f = parseFloat(values[5]);
      }
    }
  }

  // Add minimal implementation for methods used by PDF.js
  multiply(matrix: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const a = this.a * matrix.a + this.c * matrix.b;
    const b = this.b * matrix.a + this.d * matrix.b;
    const c = this.a * matrix.c + this.c * matrix.d;
    const d = this.b * matrix.c + this.d * matrix.d;
    const e = this.a * matrix.e + this.c * matrix.f + this.e;
    const f = this.b * matrix.e + this.d * matrix.f + this.f;

    const result = new DOMMatrixPolyfill();
    result.a = a;
    result.b = b;
    result.c = c;
    result.d = d;
    result.e = e;
    result.f = f;
    return result;
  }

  // Add additional methods as needed
}

// Set up the DOMMatrix polyfill globally
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
}

// Use dynamic import for PDF.js to avoid startup performance issues
// This will load PDF.js only when needed
let PDFjs: any;
const loadPDFjs = async () => {
  if (!PDFjs) {
    try {
      // Use ES module version instead of legacy
      const pdfModule = await import('pdfjs-dist');
      PDFjs = pdfModule.default;
    } catch (err) {
      console.error('Error loading pdfjs-dist:', err);
      throw new Error(`Failed to load PDF.js: ${err}`);
    }
  }
  return PDFjs;
};

// Function to set worker path when PDFjs is loaded
const setupWorker = async (pdfjs: any) => {
  try {
    // Try to use the proper ES module worker path
    const workerPath = path.join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.mjs');
    
    if (fs.existsSync(workerPath)) {
      pdfjs.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;
    } else {
      // Fallback to the CDN worker
      console.warn('PDF.js worker not found at expected path. Using CDN worker path.');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@latest/build/pdf.worker.min.js';
    }
  } catch (err) {
    console.error('Error setting up PDF.js worker:', err);
    // Continue anyway - some environments may work without explicit worker setup
  }
  
  return pdfjs;
};

// Export a function that returns the PDFjs library (lazy-loaded)
export const getPdfLib = async () => {
  try {
    const pdfjs = await loadPDFjs();
    return await setupWorker(pdfjs);
  } catch (error) {
    console.error('Error initializing PDF.js library:', error);
    throw error;
  }
};