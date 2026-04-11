import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { convertHtmlToPdf } from './converter';

// This is the Chromium path we discovered earlier in the Termux environment.
const chromiumPath = '/data/data/com.termux/files/usr/bin/chromium-browser';

describe('Integration Test: convertHtmlToPdf', () => {
  const testOutputDir = path.join(__dirname, '..', 'test-output');
  const inputHtmlPath = path.join(testOutputDir, 'test.html');
  const outputPdfPath = path.join(testOutputDir, 'test.pdf');

  beforeAll(() => {
    // Create test-output directory if it doesn't exist
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }

    // Create a test HTML file with a specific @page size
    // For example, 500px by 400px. Puppeteer understands css units.
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @page {
            size: 500px 400px;
            margin: 0;
          }
          body {
            background-color: lightblue;
            margin: 0;
            padding: 20px;
            font-family: sans-serif;
          }
        </style>
      </head>
      <body>
        <h1>Hello PDF Integration Test</h1>
        <p>This should be a 500x400 sized PDF page.</p>
      </body>
      </html>
    `;
    fs.writeFileSync(inputHtmlPath, htmlContent, 'utf8');
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(inputHtmlPath)) {
      fs.rmSync(inputHtmlPath);
    }
    if (fs.existsSync(outputPdfPath)) {
      fs.rmSync(outputPdfPath);
    }
  });

  it('should successfully convert HTML to PDF and respect @page size', async () => {
    // Skip test if chromium isn't available
    if (!fs.existsSync(chromiumPath)) {
      console.warn(`Skipping integration test: Chromium not found at ${chromiumPath}`);
      return;
    }

    // Call the conversion logic
    await convertHtmlToPdf({
      chromiumPath,
      src: inputHtmlPath,
      dest: outputPdfPath,
      force: true, // Overwrite if it exists
    });

    // Verify the PDF file was created
    expect(fs.existsSync(outputPdfPath)).toBe(true);

    // Verify the file size is greater than 0
    const stat = fs.statSync(outputPdfPath);
    expect(stat.size).toBeGreaterThan(0);

    // Load the PDF to check its dimensions
    const pdfBytes = fs.readFileSync(outputPdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    const pages = pdfDoc.getPages();
    expect(pages.length).toBe(1);

    const firstPage = pages[0];
    if (!firstPage) {
      throw new Error('PDF has no pages');
    }
    const { width, height } = firstPage.getSize();

    // Puppeteer might convert pixels to points (1 px = 0.75 pt) or keep them same depending on DPI.
    // CSS pixel size in print usually maps to 1px = 1/96 inch, and PDF uses points (1/72 inch).
    // So 500px = 500 * (72 / 96) = 375 points.
    // And 400px = 400 * (72 / 96) = 300 points.
    // We'll use toBeCloseTo to account for minor rounding differences.
    const expectedWidth = 500 * (72 / 96);
    const expectedHeight = 400 * (72 / 96);

    expect(width).toBeCloseTo(expectedWidth, 0);
    expect(height).toBeCloseTo(expectedHeight, 0);
  }, 15000); // 15 seconds timeout for browser launch and conversion
});
