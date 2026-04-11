import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import inquirer from 'inquirer';
import * as cheerio from 'cheerio';
import mime from 'mime-types';

export interface ConvertOptions {
  chromiumPath: string;
  src: string;
  dest: string;
  force?: boolean;
}

async function inlineImagesInHtml(html: string, baseDir: string): Promise<string> {
  const $ = cheerio.load(html);
  const images = $('img').toArray();

  for (const img of images) {
    const src = $(img).attr('src');
    if (!src || src.startsWith('data:')) {
      continue; // Skip if no src or already inline
    }

    try {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        // Fetch remote image using Node.js fetch
        const response = await fetch(src);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch remote image ${src} (status: ${response.status})`);
          continue;
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || mime.lookup(src) || 'image/png';
        const base64 = buffer.toString('base64');
        $(img).attr('src', `data:${contentType};base64,${base64}`);
      } else {
        // Read local image
        const imgPath = path.resolve(baseDir, src);
        if (fs.existsSync(imgPath)) {
          const buffer = fs.readFileSync(imgPath);
          const contentType = mime.lookup(imgPath) || 'image/png';
          const base64 = buffer.toString('base64');
          $(img).attr('src', `data:${contentType};base64,${base64}`);
        } else {
          console.warn(`Warning: Local image not found ${imgPath}`);
        }
      }
    } catch (err: any) {
      console.warn(`Warning: Error processing image ${src}: ${err.message}`);
    }
  }

  return $.html();
}

export async function convertHtmlToPdf(options: ConvertOptions) {
  const { chromiumPath, src, dest, force } = options;

  if (!fs.existsSync(chromiumPath)) {
    throw new Error(`Chromium not found at: ${chromiumPath}`);
  }

  const srcPath = path.resolve(process.cwd(), src);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Source HTML file not found: ${src}`);
  }

  const destPath = path.resolve(process.cwd(), dest);
  if (fs.existsSync(destPath) && !force) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Destination file ${dest} already exists. Overwrite?`,
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log('Skipped.');
      return;
    }
  }

  console.log(`Converting ${src} to ${dest}...`);

  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    const rawHtmlContent = fs.readFileSync(srcPath, 'utf8');
    
    // Inline images before passing to Chromium
    console.log('Inlining images...');
    const htmlContent = await inlineImagesInHtml(rawHtmlContent, path.dirname(srcPath));

    // Set HTML content directly, wait until DOM is ready
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

    // Explicitly wait for all images to be fully loaded (just in case there are background images)
    await page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      await Promise.all(images.map(img => {
        if (img.complete) return;
        return new Promise((resolve) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
        });
      }));
    });

    // PDF options: prefer @page styles, fallback to A4
    await page.pdf({
      path: destPath,
      format: 'A4', // This will be used if @page doesn't specify size
      printBackground: true,
      preferCSSPageSize: true, 
    });

    console.log('Successfully generated PDF.');
  } finally {
    await browser.close();
  }
}
