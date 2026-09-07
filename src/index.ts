#!/usr/bin/env node
import { Command } from "commander";
import { convertHtmlToPdf } from "./converter";

const program = new Command();

program
	.name("html2pdf")
	.description("Convert HTML to PDF using Chromium")
	.version("1.0.0")
	.requiredOption("--chromium-path <path>", "Path to Chromium executable")
	.requiredOption("--src <path>", "Source HTML file path")
	.requiredOption("--dest <path>", "Destination PDF path")
	.option(
		"-y, --force",
		"Overwrite destination file without confirmation",
		false,
	)
	.action(async (options) => {
		try {
			await convertHtmlToPdf({
				chromiumPath: options.chromiumPath,
				src: options.src,
				dest: options.dest,
				force: options.force,
			});
		} catch (error) {
			console.error(`Error: ${(error as Error).message}`);
			process.exit(1);
		}
	});

program.parse(process.argv);
