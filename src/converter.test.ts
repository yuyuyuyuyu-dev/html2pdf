import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineImagesInHtml, inlineStylesAndFontsInHtml } from "./converter";

vi.mock("fs");

describe("inlineImagesInHtml", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should inline remote images fetching them and converting to base64", async () => {
		const html =
			'<html><body><img src="https://example.com/image.png" /></body></html>';

		// Mock the global fetch API to simulate downloading an image
		const mockResponse = {
			ok: true,
			headers: new Headers({ "content-type": "image/png" }),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)), // 8 bytes of empty data
		};
		vi.mocked(global.fetch).mockResolvedValue(mockResponse);

		const result = await inlineImagesInHtml(html, "/tmp");

		// An 8-byte ArrayBuffer of zeros encodes to 'AAAAAAAAAAA=' in Base64
		expect(result).toContain("data:image/png;base64,AAAAAAAAAAA=");
		expect(global.fetch).toHaveBeenCalledWith("https://example.com/image.png");
	});

	it("should inline local images by reading from the file system", async () => {
		const html = '<html><body><img src="local.jpg" /></body></html>';

		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		// Mock reading local file system to return a buffer
		vi.spyOn(fs, "readFileSync").mockReturnValue(
			Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]) as unknown as string,
		);

		const result = await inlineImagesInHtml(html, "/tmp");

		// mime-types lookup should correctly identify local.jpg as image/jpeg
		expect(result).toContain("data:image/jpeg;base64,AAAAAAAAAAA=");
		expect(fs.readFileSync).toHaveBeenCalledWith(
			expect.stringContaining("local.jpg"),
		);
	});

	it("should leave already inlined base64 data URIs untouched", async () => {
		const html =
			'<html><body><img src="data:image/png;base64,existing" /></body></html>';

		const result = await inlineImagesInHtml(html, "/tmp");

		expect(result).toContain("data:image/png;base64,existing");
		expect(global.fetch).not.toHaveBeenCalled();
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});

	it("should skip remote images if fetch fails", async () => {
		const html =
			'<html><body><img src="https://example.com/notfound.png" /></body></html>';

		const mockResponse = {
			ok: false,
			status: 404,
		};
		vi.mocked(global.fetch).mockResolvedValue(mockResponse);

		const result = await inlineImagesInHtml(html, "/tmp");

		// Should remain unchanged because it failed
		expect(result).toContain('src="https://example.com/notfound.png"');
	});
});

describe("inlineStylesAndFontsInHtml", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should fetch remote stylesheets and inline them in a style tag", async () => {
		const html =
			'<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto" /></head><body></body></html>';

		const mockResponse = {
			ok: true,
			text: vi.fn().mockResolvedValue('body { font-family: "Roboto"; }'),
		};
		vi.mocked(global.fetch).mockResolvedValue(mockResponse);

		const result = await inlineStylesAndFontsInHtml(html, "/tmp");

		expect(result).toContain('<style>body { font-family: "Roboto"; }</style>');
		expect(result).not.toContain('<link rel="stylesheet"');
		expect(global.fetch).toHaveBeenCalledWith(
			"https://fonts.googleapis.com/css?family=Roboto",
			expect.any(Object),
		);
	});

	it("should read local stylesheets and inline them in a style tag", async () => {
		const html =
			'<html><head><link rel="stylesheet" href="style.css" /></head><body></body></html>';

		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		vi.spyOn(fs, "readFileSync").mockReturnValue("body { color: red; }");

		const result = await inlineStylesAndFontsInHtml(html, "/tmp");

		expect(result).toContain("<style>body { color: red; }</style>");
		expect(fs.readFileSync).toHaveBeenCalledWith(
			expect.stringContaining("style.css"),
			"utf8",
		);
	});

	it("should inline fonts inside url() within style tags to base64", async () => {
		const html =
			'<html><head><style>@font-face { src: url("https://example.com/font.woff2"); }</style></head><body></body></html>';

		const mockResponse = {
			ok: true,
			headers: new Headers({ "content-type": "font/woff2" }),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)), // 4 bytes empty data -> 'AAAAAA==' in Base64
		};
		vi.mocked(global.fetch).mockResolvedValue(mockResponse);

		const result = await inlineStylesAndFontsInHtml(html, "/tmp");

		expect(result).toContain(
			'url("data:font/woff2;charset=utf-8;base64,AAAAAA==")',
		);
		expect(global.fetch).toHaveBeenCalledWith("https://example.com/font.woff2");
	});

	it("should skip replacing url() if fetch fails", async () => {
		const html =
			'<html><head><style>@font-face { src: url("https://example.com/notfound.woff2"); }</style></head><body></body></html>';

		const mockResponse = {
			ok: false,
			status: 404,
		};
		vi.mocked(global.fetch).mockResolvedValue(mockResponse);

		const result = await inlineStylesAndFontsInHtml(html, "/tmp");

		expect(result).toContain('url("https://example.com/notfound.woff2")');
	});
});
