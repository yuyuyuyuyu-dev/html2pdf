import fs from "node:fs";
import inquirer from "inquirer";
import puppeteer, { type Browser } from "puppeteer-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
// We'll export the core logic for testing
import { convertHtmlToPdf } from "./converter";

vi.mock("fs");
vi.mock("puppeteer-core");
vi.mock("inquirer");

describe("convertHtmlToPdf", () => {
	const options = {
		chromiumPath: "/path/to/chromium",
		src: "input.html",
		dest: "output.pdf",
		force: false,
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should throw an error if chromium-path does not exist", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		await expect(convertHtmlToPdf(options)).rejects.toThrow(
			"Chromium not found at: /path/to/chromium",
		);
	});

	it("should throw an error if source HTML does not exist", async () => {
		vi.spyOn(fs, "existsSync").mockImplementation((path) => {
			if (path === "/path/to/chromium") return true;
			if (path === "input.html") return false;
			return false;
		});
		await expect(convertHtmlToPdf(options)).rejects.toThrow(
			"Source HTML file not found: input.html",
		);
	});

	it("should ask for confirmation if destination exists and force is false", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		vi.spyOn(inquirer, "prompt").mockResolvedValue({ overwrite: false });

		await convertHtmlToPdf(options);

		expect(inquirer.prompt).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ name: "overwrite" })]),
		);
		// Should not call puppeteer if user says no
		expect(puppeteer.launch).not.toHaveBeenCalled();
	});

	it("should proceed with conversion if destination exists and force is true", async () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		const mockPage = {
			setContent: vi.fn(),
			evaluate: vi.fn(),
			pdf: vi.fn(),
		};
		const mockBrowser = {
			newPage: vi.fn().mockResolvedValue(mockPage),
			close: vi.fn(),
		};
		vi.spyOn(puppeteer, "launch").mockResolvedValue(
			mockBrowser as unknown as Browser,
		);
		vi.spyOn(fs, "readFileSync").mockReturnValue("<html></html>");

		await convertHtmlToPdf({ ...options, force: true });

		expect(inquirer.prompt).not.toHaveBeenCalled();
		expect(puppeteer.launch).toHaveBeenCalled();
	});
});
