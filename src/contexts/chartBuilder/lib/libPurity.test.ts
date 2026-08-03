import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/** lib/ is the pure-logic layer: importing anything from it (mode
 *  detection, channel metadata, scales…) must never drag React component
 *  trees along. Component bindings live on the components side
 *  (`components/viz/rendererRegistry.ts`,
 *  `components/sidebar/channelOptions/channelPanels.ts`).
 *
 *  Known exception: `lib/coords/` builds axis-layer JSX and imports the
 *  Axis component. Its barrel is imported ONLY by components (renderers +
 *  Plot), so the edge contaminates no pure consumer — it's tolerated
 *  until coords moves to the components side. Do NOT add new exceptions;
 *  put component-importing code in components/ instead. */

const LIB_DIR = join(__dirname)
const ALLOWED = new Set(["coords/cartesian.tsx"])

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
