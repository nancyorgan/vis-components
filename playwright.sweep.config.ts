import { defineConfig, devices } from "@playwright/test"

/** Browser sweeps (`e2e/sweep/*.sweep.ts`): long-running audits that build
 *  one chart of every type and drive every control. Kept out of the regular
 *  e2e run (`playwright.config.ts` matches `*.spec.ts` only) because a full
 *  sweep takes tens of minutes.
 *
 *    pnpm run test:sweep                      everything
 *    pnpm run test:sweep -- options           the options sweep
 *    SWEEP_CHARTS=line,area-stacked pnpm run test:sweep -- options
 *
 *  Set PW_CHANNEL=chrome to use the installed Chrome instead of
 *  Playwright's bundled Chromium. Results land in e2e/screenshots/sweep/. */

/** The sweep's own server (`vite.sweep.config.ts`): frozen — no file
 *  watching, no hot reload — so nothing edited during a run can reload the
 *  page under a control change. Playwright starts it and stops it; it never
 *  reuses an ordinary dev server, which would reload. */
const PORT = 3011

export default defineConfig({
	testDir: "./e2e/sweep",
	testMatch: /.*\.sweep\.ts/,
	timeout: 30 * 60_000,
	fullyParallel: true,
	workers: process.env.SWEEP_WORKERS ? Number(process.env.SWEEP_WORKERS) : 4,
	retries: 0,
	reporter: [["list"]],
	globalTeardown: "./e2e/sweep/report.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1280, height: 900 },
		actionTimeout: 4000,
		...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
	},
	projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
	webServer: {
		command: `pnpm vite --config vite.sweep.config.ts --port ${PORT} --strictPort --host`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: false,
		timeout: 60_000,
	},
})
