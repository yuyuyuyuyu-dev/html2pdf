import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFStream } from "pdf-lib";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

const cli = path.resolve(__dirname, "../../dist/index.js");

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAoElEQVR4nA3OgQADUQxEwSAUIQiHEIRDWISPsAiHEIRDCEIRYvLaIZiICDI+VCSKC0fRcTMhNg4R+SEzqbxQFs6bTjF52DQRlWRdVBWqG5foOkyZrYcIXaSK0o0krEPLjB5WTYSL9E1ZyAfbtB/Gzfr9H/omW1Qf1Mb90N1Mv2zP/zAi51BjNA+epudlZtj5/g97yDW1D9rG+9I7zH7ZXX7jRpPBudYfSAAAAABJRU5ErkJggg==",
	"base64",
);

const pageSizeCss = "@page { size: 300pt 225pt; margin: 0; }";

let chromiumPath: string;
let server: http.Server;
let origin: string;
let cwd: string;

function routes(): Record<string, { type: string; body: string | Buffer }> {
	return {
		"/image.png": { type: "image/png", body: png },
		"/style.css": { type: "text/css", body: pageSizeCss },
		"/background.css": {
			type: "text/css",
			body: `${pageSizeCss} body { background-image: url("${origin}/image.png"); }`,
		},
	};
}

function run(
	args: string[],
	answer?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], { cwd });
		let stdout = "";
		let stderr = "";
		let answered = false;
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (
				answer !== undefined &&
				!answered &&
				stdout.replace(/\s/g, "").includes("(y/N)")
			) {
				answered = true;
				child.stdin.end(`${answer}\n`);
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

function convert(src: string, dest: string, ...options: string[]) {
	return run([
		"--chromium-path",
		chromiumPath,
		"--src",
		src,
		"--dest",
		dest,
		...options,
	]);
}

function write(name: string, content: string | Buffer) {
	fs.writeFileSync(path.join(cwd, name), content);
}

async function load(name: string) {
	return PDFDocument.load(fs.readFileSync(path.join(cwd, name)));
}

async function pageSizes(name: string) {
	return (await load(name)).getPages().map((page) => page.getSize());
}

async function imageCount(name: string) {
	return (await load(name)).context
		.enumerateIndirectObjects()
		.filter(
			([, object]) =>
				object instanceof PDFStream &&
				object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
		).length;
}

beforeAll(async () => {
	const envChromiumPath = process.env.CHROMIUM_PATH;
	if (!envChromiumPath) {
		throw new Error("CHROMIUM_PATH is not set");
	}
	chromiumPath = envChromiumPath;
	server = http.createServer((request, response) => {
		const route = routes()[request.url ?? ""];
		if (!route) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": route.type }).end(route.body);
	});
	await new Promise<void>((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve()),
	);
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "html2pdf-"));
});

afterEach(() => {
	fs.rmSync(cwd, { recursive: true, force: true });
});

describe("options", () => {
	it("should fail when a required option is missing", async () => {
		// Arrange
		write("source.html", "<p>Hello</p>");

		// Act
		const result = await run([
			"--chromium-path",
			chromiumPath,
			"--src",
			"source.html",
		]);

		// Assert
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("--dest");
	});

	it("should fail when Chromium is not found", async () => {
		// Arrange
		write("source.html", "<p>Hello</p>");
		const missingChromiumPath = path.join(cwd, "chromium");

		// Act
		const result = await run([
			"--chromium-path",
			missingChromiumPath,
			"--src",
			"source.html",
			"--dest",
			"output.pdf",
		]);

		// Assert
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			`Error: Chromium not found at: ${missingChromiumPath}`,
		);
		expect(fs.existsSync(path.join(cwd, "output.pdf"))).toBe(false);
	});

	it("should fail when the source HTML file is not found", async () => {
		// Act
		const result = await convert("missing.html", "output.pdf");

		// Assert
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(
			"Error: Source HTML file not found: missing.html",
		);
		expect(fs.existsSync(path.join(cwd, "output.pdf"))).toBe(false);
	});
});

describe("destination", () => {
	it("should create the destination file relative to the current directory", async () => {
		// Arrange
		fs.mkdirSync(path.join(cwd, "in"));
		fs.mkdirSync(path.join(cwd, "out"));
		write("in/source.html", "<p>Hello</p>");

		// Act
		const result = await convert("in/source.html", "out/output.pdf");

		// Assert
		expect(result.code).toBe(0);
		expect(await pageSizes("out/output.pdf")).toHaveLength(1);
	});

	it("should keep the existing destination file when overwriting is declined", async () => {
		// Arrange
		write("source.html", "<p>Hello</p>");
		write("output.pdf", "existing");

		// Act
		const result = await run(
			[
				"--chromium-path",
				chromiumPath,
				"--src",
				"source.html",
				"--dest",
				"output.pdf",
			],
			"n",
		);

		// Assert
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Skipped.");
		expect(fs.readFileSync(path.join(cwd, "output.pdf"), "utf8")).toBe(
			"existing",
		);
	});

	it("should overwrite the existing destination file when overwriting is accepted", async () => {
		// Arrange
		write("source.html", "<p>Hello</p>");
		write("output.pdf", "existing");

		// Act
		const result = await run(
			[
				"--chromium-path",
				chromiumPath,
				"--src",
				"source.html",
				"--dest",
				"output.pdf",
			],
			"y",
		);

		// Assert
		expect(result.code).toBe(0);
		expect(await pageSizes("output.pdf")).toHaveLength(1);
	});

	it.each(["--force", "-y"])(
		"should overwrite the existing destination file without asking when %s is given",
		async (option) => {
			// Arrange
			write("source.html", "<p>Hello</p>");
			write("output.pdf", "existing");

			// Act
			const result = await convert("source.html", "output.pdf", option);

			// Assert
			expect(result.code).toBe(0);
			expect(result.stdout).not.toContain("(y/N)");
			expect(await pageSizes("output.pdf")).toHaveLength(1);
		},
	);
});

describe("page size", () => {
	it("should use A4 when the HTML does not set a page size", async () => {
		// Arrange
		write("source.html", "<p>Hello</p>");

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		const [size] = await pageSizes("output.pdf");
		expect(size?.width).toBeCloseTo(595.28, -1);
		expect(size?.height).toBeCloseTo(841.89, -1);
	});
});

describe("images", () => {
	it("should embed a local image", async () => {
		// Arrange
		write("image.png", png);
		write("source.html", '<img src="image.png" width="100" height="100">');

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		expect(await imageCount("output.pdf")).toBe(1);
	});

	it("should embed a remote image", async () => {
		// Arrange
		write(
			"source.html",
			`<img src="${origin}/image.png" width="100" height="100">`,
		);

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		expect(await imageCount("output.pdf")).toBe(1);
	});

	it("should embed an image given as a data URI", async () => {
		// Arrange
		write(
			"source.html",
			`<img src="data:image/png;base64,${png.toString("base64")}" width="100" height="100">`,
		);

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		expect(await imageCount("output.pdf")).toBe(1);
	});

	it("should convert without a local image that is not found", async () => {
		// Arrange
		write("source.html", '<img src="missing.png" width="100" height="100">');

		// Act
		const result = await convert("source.html", "output.pdf");

		// Assert
		expect(result.code).toBe(0);
		expect(result.stderr).toContain("Warning: Local image not found");
		expect(await imageCount("output.pdf")).toBe(0);
	});

	it("should convert without a remote image that cannot be fetched", async () => {
		// Arrange
		write(
			"source.html",
			`<img src="${origin}/missing.png" width="100" height="100">`,
		);

		// Act
		const result = await convert("source.html", "output.pdf");

		// Assert
		expect(result.code).toBe(0);
		expect(result.stderr).toContain(
			`Warning: Failed to fetch remote image ${origin}/missing.png`,
		);
		expect(await pageSizes("output.pdf")).toHaveLength(1);
	});
});

describe("stylesheets", () => {
	it("should apply a local stylesheet", async () => {
		// Arrange
		write("style.css", pageSizeCss);
		write(
			"source.html",
			'<link rel="stylesheet" href="style.css"><p>Hello</p>',
		);

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		const [size] = await pageSizes("output.pdf");
		expect(size?.width).toBeCloseTo(300, 0);
		expect(size?.height).toBeCloseTo(225, 0);
	});

	it("should apply a remote stylesheet", async () => {
		// Arrange
		write(
			"source.html",
			`<link rel="stylesheet" href="${origin}/style.css"><p>Hello</p>`,
		);

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		const [size] = await pageSizes("output.pdf");
		expect(size?.width).toBeCloseTo(300, 0);
		expect(size?.height).toBeCloseTo(225, 0);
	});

	it("should convert without a local stylesheet that is not found", async () => {
		// Arrange
		write(
			"source.html",
			'<link rel="stylesheet" href="missing.css"><p>Hello</p>',
		);

		// Act
		const result = await convert("source.html", "output.pdf");

		// Assert
		expect(result.code).toBe(0);
		expect(result.stderr).toContain("Warning: Local stylesheet not found");
		expect(await pageSizes("output.pdf")).toHaveLength(1);
	});

	it("should convert without a remote stylesheet that cannot be fetched", async () => {
		// Arrange
		write(
			"source.html",
			`<link rel="stylesheet" href="${origin}/missing.css"><p>Hello</p>`,
		);

		// Act
		const result = await convert("source.html", "output.pdf");

		// Assert
		expect(result.code).toBe(0);
		expect(result.stderr).toContain(
			`Warning: Failed to fetch stylesheet ${origin}/missing.css`,
		);
		expect(await pageSizes("output.pdf")).toHaveLength(1);
	});
});

describe("resources referenced by url()", () => {
	it("should embed a remote resource referenced in a style element", async () => {
		// Arrange
		write(
			"source.html",
			`<style>body { background-image: url("${origin}/image.png"); }</style><p>Hello</p>`,
		);

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		expect(await imageCount("output.pdf")).toBe(1);
	});

	it("should embed a remote resource referenced in a remote stylesheet", async () => {
		// Arrange
		write(
			"source.html",
			`<link rel="stylesheet" href="${origin}/background.css"><p>Hello</p>`,
		);

		// Act
		await convert("source.html", "output.pdf");

		// Assert
		const [size] = await pageSizes("output.pdf");
		expect(size?.width).toBeCloseTo(300, 0);
		expect(size?.height).toBeCloseTo(225, 0);
		expect(await imageCount("output.pdf")).toBe(1);
	});

	it("should convert without a remote resource that cannot be fetched", async () => {
		// Arrange
		write(
			"source.html",
			`<style>body { background-image: url("${origin}/missing.png"); }</style><p>Hello</p>`,
		);

		// Act
		const result = await convert("source.html", "output.pdf");

		// Assert
		expect(result.code).toBe(0);
		expect(await imageCount("output.pdf")).toBe(0);
	});
});
