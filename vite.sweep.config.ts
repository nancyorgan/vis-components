import { defineConfig, mergeConfig } from "vite"

import base from "./vite.config"

/** The dev server the browser sweeps run against (`playwright.sweep.config.ts`).
 *
 *  It is the ordinary dev server with file watching and hot reload switched
 *  OFF. A sweep changes one control, compares the chart before and after,
 *  and takes tens of minutes; the ordinary server reloads the page whenever
 *  ANY file in the repo changes (a source file, a test, a Markdown doc, the
 *  sweep's own report), which throws away the change under test and reads as
 *  "this control does nothing". Frozen, the sweep tests the code as it stood
 *  when the server started, whatever is edited meanwhile. */
export default mergeConfig(
	base,
	defineConfig({
		server: {
			hmr: false,
			watch: { ignored: ["**"] },
		},
	})
)
