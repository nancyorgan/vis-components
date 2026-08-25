import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** lib/ is the pure-logic layer: importing anything from it (mode
 *  detection, channel metadata, scales…) must never drag React component
 *  trees along. Component bindings live on the components side
 *  (`components/viz/rendererRegistry.ts`,
 *  `components/sidebar/channelOptions/channelPanels.ts`).
 *
 *  There are NO exceptions. The coord factories (`cartesian`/`radial`/
 *  `geographic`) used to live here and imported the Axis component; they
 *  now live in `components/viz/coords/`. Only their pure scale/render
 *  contracts stayed behind in `lib/coords/types.ts`, which pure consumers
 *  (e.g. `lib/radarScales.ts`) still import. Put component-importing code
 *  in components/ instead of re-opening an allowlist. */

const LIB_DIR = join(__dirname)
const ALLOWED = new Set<string>()

const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) return walk(full)
		return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
			? [full]
			: []
	})

describe("lib purity", () => {
	it("no lib module imports from components/ (except the documented coords exception)", () => {
		const offenders: string[] = []
		for (const file of walk(LIB_DIR)) {
			const rel = file.slice(LIB_DIR.length + 1)
			if (ALLOWED.has(rel)) continue
			const src = readFileSync(file, "utf8")
			if (/from\s+["'][^"']*\/components\//.test(src)) offenders.push(rel)
		}
		expect(offenders).toEqual([])
	})
})
