import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import inquirer from 'inquirer';

export interface ConvertOptions {
  chromiumPath: string;
  src: string;
  dest: string;
  force?: boolean;
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
    const htmlContent = fs.readFileSync(srcPath, 'utf8');
    
    // Use networkidle0 to wait for resources
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

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
