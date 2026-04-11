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

export async function inlineImagesInHtml(html: string, baseDir: string): Promise<string> {
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

export async function inlineStylesAndFontsInHtml(html: string, baseDir: string): Promise<string> {
  const $ = cheerio.load(html);
  const links = $('link[rel="stylesheet"]').toArray();

  // 1. Inline all stylesheets (remote and local) into <style> tags
  for (const link of links) {
    const href = $(link).attr('href');
    if (!href) continue;

    try {
      let cssContent = '';
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const response = await fetch(href, {
          headers: {
            // Need a modern User-Agent so Google Fonts returns woff2 instead of older formats
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch stylesheet ${href} (status: ${response.status})`);
          continue;
        }
        cssContent = await response.text();
      } else if (!href.startsWith('data:')) {
        // Local stylesheet
        const cssPath = path.resolve(baseDir, href);
        if (fs.existsSync(cssPath)) {
          cssContent = fs.readFileSync(cssPath, 'utf8');
        } else {
          console.warn(`Warning: Local stylesheet not found ${cssPath}`);
          continue;
        }
      }

      if (cssContent) {
        $(link).replaceWith(`<style>${cssContent}</style>`);
      }
    } catch (err: any) {
      console.warn(`Warning: Error processing stylesheet ${href}: ${err.message}`);
    }
  }

  // 2. Inline all url(...) references (like fonts or background images) inside <style> tags
  const styles = $('style').toArray();
  for (const style of styles) {
    let cssContent = $(style).html() || '';
    
    // Match url("https://...") or url('https://...') or url(https://...)
    const urlRegex = /url\((['"]?)(https?:\/\/[^'")]+)\1\)/g;
    let match;
    const replacements: { original: string, newText: string }[] = [];
    
    while ((match = urlRegex.exec(cssContent)) !== null) {
      const fullMatch = match[0];
      const resourceUrl = match[2];
      
      try {
        const res = await fetch(resourceUrl);
        if (!res.ok) continue;
        
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || mime.lookup(resourceUrl) || 'application/octet-stream';
        const base64 = buffer.toString('base64');
        const dataUri = `data:${contentType};charset=utf-8;base64,${base64}`;
        
        replacements.push({ original: fullMatch, newText: `url("${dataUri}")` });
      } catch (err: any) {
        console.warn(`Warning: Error fetching CSS resource ${resourceUrl}: ${err.message}`);
      }
    }
    
    for (const r of replacements) {
      cssContent = cssContent.split(r.original).join(r.newText);
    }
    
    $(style).html(cssContent);
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
    const baseDir = path.dirname(srcPath);

    // Inline resources before passing to Chromium
    console.log('Inlining images...');
    let htmlContent = await inlineImagesInHtml(rawHtmlContent, baseDir);
    
    console.log('Inlining stylesheets and fonts...');
    htmlContent = await inlineStylesAndFontsInHtml(htmlContent, baseDir);

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
