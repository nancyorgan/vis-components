import { defineConfig, devices } from "@playwright/test"

/** Visual-regression / smoke harness.
 *
 *  Each test seeds the editor via localStorage `addInitScript` and asserts
 *  on the rendered SVG. Screenshots land in `e2e/screenshots/` for visual
 *  comparison.
 */

const PORT = 3010

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: [["list"]],
	use: {
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chrome",
			use: {
				...devices["Desktop Chrome"],
				baseURL: `http://localhost:${PORT}`,
				viewport: { width: 1280, height: 800 },
			},
			testMatch: /.*\.spec\.ts/,
		},
	],
	webServer: {
		command: `pnpm vite --port ${PORT} --host`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
})
