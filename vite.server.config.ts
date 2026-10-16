import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"

import { settingCatalog } from "./tooling/setting-catalog.js"

/** The self-host server build: one ESM file, `server/dist/main.js`, run
 *  with plain `node`. The server shares pure modules with the frontend
 *  (chart-spec composition under src/contexts/chartBuilder/lib), whose
 *  extensionless imports Node can't resolve, so the server is bundled
 *  rather than compiled file by file. Every package import is inlined,
 *  which keeps the output free of runtime dependencies; only Node's own
 *  modules stay external. */
export default defineConfig({
	plugins: [settingCatalog()],
	// public/ holds frontend assets; the server serves them from dist/.
	publicDir: false,
	build: {
		ssr: fileURLToPath(new URL("./server/src/main.ts", import.meta.url)),
		outDir: "server/dist",
		emptyOutDir: true,
		target: "node22",
		minify: false,
		rollupOptions: {
			external: [...builtinModules, /^node:/],
			output: { entryFileNames: "main.js", format: "es" },
		},
	},
	ssr: {
		noExternal: true,
		target: "node",
	},
})
