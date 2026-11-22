import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		testTimeout: 60_000,
		projects: [
			{
				extends: true,
				test: {
					name: "non-spec",
					include: ["test/non-spec/**/*.test.ts"],
				},
			},
		],
	},
});
