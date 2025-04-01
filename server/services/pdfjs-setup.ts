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

// Use legacy build of PDF.js for Node.js environment
// Importing as ES module for compatibility with ES modules
import * as PDFjs from 'pdfjs-dist/legacy/build/pdf.js';

// Set PDF.js worker path
const pdfjsWorker = path.join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.js');
if (fs.existsSync(pdfjsWorker)) {
  PDFjs.GlobalWorkerOptions.workerSrc = `file://${pdfjsWorker}`;
} else {
  console.warn('PDF.js worker not found at expected path. Using default worker path.');
  // Use CDN for worker as fallback
  PDFjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
}

export const pdfjsLib = PDFjs;