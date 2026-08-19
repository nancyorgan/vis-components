/// <reference types="vitest" />
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

import pkg from "./package.json"

export default defineConfig({
	plugins: [react(), viteSingleFile()],
	// Compile-time stamps shown in the header so a shared dist/index.html
	// self-identifies which build it is. Version comes from package.json
	// (with a trailing ".0" patch trimmed for display: 1.0.0 → "1.0");
	// the date is when `pnpm build` (or the dev server) last ran.
	define: {
		__APP_VERSION__: `"${pkg.version.replace(/\.0$/, "")}"`,
		__BUILD_DATE__: `"${new Date().toISOString()}"`,
	},
	build: {
		// The single-file dist/index.html is checked into a repo — keep the
		// output unminified so update diffs stay readable.
		minify: false,
	},
	server: {
		host: "localhost",
		port: 3002,
		// Frontend dev against a running self-host server: set VIS_DEV_API to
		// its address (e.g. `VIS_DEV_API=http://localhost:8080 pnpm dev`) and
		// /api proxies there, so the dev editor boots into server mode. Unset —
		// the default — /api 404s and the editor stays browser-local.
		proxy: process.env.VIS_DEV_API
			? { "/api": { target: process.env.VIS_DEV_API, changeOrigin: true } }
			: undefined,
	},
	test: {
		environment: "happy-dom",
		// Self-host server tests live under server/src and opt into the node
		// environment per-file via `// @vitest-environment node`.
		include: ["src/**/*.test.{ts,tsx}", "server/src/**/*.test.ts"],
		// Runs once per test file, before the file's own module body. Puts
		// every suite on an isolated in-memory localStorage (see the file).
		setupFiles: ["src/testSupport/vitest.setup.ts"],
		// Playwright specs live under e2e/ and have a different runner — keep
		// vitest from picking them up.
		exclude: ["**/node_modules/**", "e2e/**"],
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
			reporter: ["text-summary", "html"],
			// Ratcheting floors: set just under the measured baseline at the
			// time coverage was introduced (2026-07-09). CI fails if coverage
			// drops below these; raise them as coverage improves, never lower.
			thresholds: {
				lines: 49,
				functions: 63,
				branches: 73,
				statements: 49,
			},
		},
	},
})
