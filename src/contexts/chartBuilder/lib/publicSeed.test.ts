import { describe, expect, it } from "vitest"

import publicSeed from "../../../seed/examples.json"
import { SYSTEM_THEMES } from "./systemThemes"

/** The stock examples reach every account as an overlay, and any theme the
 *  seed carries joins every account's theme list along with them (see
 *  exampleOverlay.ts). An account starts with the two built-in themes and
 *  nothing else, so the public seed ships no themes of its own and every
 *  example uses a built-in one.
 *
 *  "Download bundle" exports the author's custom themes too — right for a
 *  backup or a private `examples.local.json`, wrong here. After re-exporting
 *  the public seed: point each example's `themeId` at `system-light` or
 *  `system-dark`, and empty `themes`. */
describe("public seed themes", () => {
	const seed = publicSeed as unknown as {
		visuals: Array<{ name: string; themeId?: string | null }>
		themes: Array<{ name: string }>
		userDefaultThemeId: string | null
	}
	const builtIn = new Set(SYSTEM_THEMES.map((t) => t.id))

	it("ships no themes of its own", () => {
		expect(seed.themes.map((t) => t.name)).toEqual([])
	})

	it("puts every example on a built-in theme", () => {
		const offTheme = seed.visuals
			.filter((v) => v.themeId == null || !builtIn.has(v.themeId))
			.map((v) => `${v.name} → ${v.themeId ?? "no theme"}`)
		expect(offTheme).toEqual([])
	})

	it("leaves the default theme alone", () => {
		expect(seed.userDefaultThemeId).toBeNull()
	})
})
