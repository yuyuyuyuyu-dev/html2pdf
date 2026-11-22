import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";

const cli = path.resolve(__dirname, "../../dist/index.js");
const outputDir = path.resolve(__dirname, "../../test-output/spec");

it("should convert to PDF", async () => {
	// Arrange
	const chromiumPath = process.env.CHROMIUM_PATH;
	if (!chromiumPath) {
		throw new Error("CHROMIUM_PATH is not set");
	}
	const pageWidthPt = 1440;
	const pageHeightPt = 720;
	fs.rmSync(outputDir, { recursive: true, force: true });
	fs.mkdirSync(outputDir, { recursive: true });
	const src = path.join(outputDir, "source.html");
	const dest = path.join(outputDir, "output.pdf");
	fs.writeFileSync(
		src,
		`<!DOCTYPE html>
<html>
  <head>
    <style>
      @page {
        size: ${pageWidthPt}pt ${pageHeightPt}pt;
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
    <h1>Hello PDF</h1>
    <p>This should be a ${pageWidthPt}x${pageHeightPt} pt sized PDF page.</p>
  </body>
</html>
`,
	);

	// Act
	await promisify(execFile)(process.execPath, [
		cli,
		"--chromium-path",
		chromiumPath,
		"--src",
		src,
		"--dest",
		dest,
		"--force",
	]);

	// Assert
	const bytes = fs.readFileSync(dest);
	expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
	const pages = (await PDFDocument.load(bytes)).getPages();
	expect(pages).toHaveLength(1);
	expect(pages[0]?.getSize()).toEqual({
		width: pageWidthPt,
		height: pageHeightPt,
	});
});
