import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

import pkg from "./package.json"

/** The published-embed runtime build: a SECOND single-file page,
 *  `dist/embed-runtime.html`, shipped beside the app. The self-host server
 *  reads it as a template at publish time and injects the payload JSON into
 *  its `#embed-payload` script tag (server/src/embedFiles.ts) — the result
 *  is the fully self-contained public file the 0016 contract requires.
 *
 *  Runs AFTER the main `vite build` (see package.json), so `emptyOutDir`
 *  must stay false. Unlike the main dist (checked into a repo, kept
 *  unminified for diffs), this file is a publish intermediate — minify it. */
export default defineConfig({
	plugins: [react(), viteSingleFile()],
	define: {
		__APP_VERSION__: `"${pkg.version.replace(/\.0$/, "")}"`,
		__BUILD_DATE__: `"${new Date().toISOString()}"`,
		// Embeds never fetch the optional ZCTA asset — it lives at an
		// app-origin-relative path a published file can't rely on. A visual
		// that needs it inlines the topology into its payload instead.
		__ZCTA_ASSET_PATH__: "null",
	},
	build: {
		outDir: "dist",
		emptyOutDir: false,
		rollupOptions: {
			input: fileURLToPath(new URL("./embed-runtime.html", import.meta.url)),
		},
	},
})
