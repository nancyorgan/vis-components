import { describe, expect, it } from "vitest"

import {
	canMoveTheme,
	decodeThemeDrag,
	encodeThemeDrag,
	folderOfTheme,
	groupThemesByFolder,
	moveNeedsAdminGate,
	moveThemeToFolder,
} from "./themeFolders"
import { isManagedTheme } from "../../chartBuilder/lib/systemThemes"
import type { SavedTheme } from "../../chartBuilder/lib/types"

/** Only the metadata matters here — the `Theme` half is irrelevant to
 *  which folder a theme sits in. */
const theme = (
	id: string,
	extra: Partial<SavedTheme> = {}
): SavedTheme =>
	({ id, name: id, isSystem: false, ...extra }) as unknown as SavedTheme

const LIST: SavedTheme[] = [
	theme("system-light", { isSystem: true, managed: true }),
	theme("system-dark", { isSystem: true, managed: true }),
	theme("th-legacy"), // saved before the folders existed
	theme("th-promoted", { managed: true }),
]

describe("groupThemesByFolder", () => {
	it("splits on the managed flag and keeps list order in each folder", () => {
		const groups = groupThemesByFolder(LIST)
		expect(groups.managed.map((t) => t.id)).toEqual([
			"system-light",
			"system-dark",
			"th-promoted",
		])
		expect(groups.custom.map((t) => t.id)).toEqual(["th-legacy"])
	})

	it("puts a theme saved before the folders existed in Custom", () => {
		expect(folderOfTheme(theme("th-legacy"))).toBe("custom")
	})
})

describe("moveThemeToFolder", () => {
	it("promotes a custom theme", () => {
		const out = moveThemeToFolder(LIST, "th-legacy", "managed")
		expect(isManagedTheme(out.find((t) => t.id === "th-legacy")!)).toBe(true)
		// Nothing else moves.
		expect(groupThemesByFolder(out).custom).toHaveLength(0)
	})

	it("demotes a promoted theme with an EXPLICIT flag, not an absent one", () => {
		const out = moveThemeToFolder(LIST, "th-promoted", "custom")
		const moved = out.find((t) => t.id === "th-promoted")!
		// An absent flag would fall back to `isSystem` — fine here, but the
		// explicit write is what keeps the rule uniform across both folders.
		expect(moved.managed).toBe(false)
		expect(isManagedTheme(moved)).toBe(false)
	})

	it("refuses to move a system theme out of Managed", () => {
		// The bundled two are read-only, so filing one under Custom Themes
		// would promise an edit that never works.
		expect(moveThemeToFolder(LIST, "system-light", "custom")).toEqual(LIST)
		expect(canMoveTheme(theme("system-light", { isSystem: true }))).toBe(false)
	})

	it("is a no-op for an unknown id or a theme already in the target", () => {
		expect(moveThemeToFolder(LIST, "nope", "managed")).toEqual(LIST)
		expect(moveThemeToFolder(LIST, "th-promoted", "managed")).toEqual(LIST)
	})
})

describe("moveNeedsAdminGate", () => {
	it("gates both directions across the boundary", () => {
		expect(moveNeedsAdminGate(LIST, "th-legacy", "managed")).toBe(true)
		expect(moveNeedsAdminGate(LIST, "th-promoted", "custom")).toBe(true)
	})

	it("does not gate a move that can't happen at all", () => {
		expect(moveNeedsAdminGate(LIST, "system-light", "custom")).toBe(false)
	})

	it("leaves a custom→custom move alone", () => {
		expect(moveNeedsAdminGate(LIST, "th-legacy", "custom")).toBe(false)
	})

	it("does not gate an unknown theme", () => {
		expect(moveNeedsAdminGate(LIST, "nope", "managed")).toBe(false)
	})
})

describe("theme drag payload", () => {
	it("round-trips an id", () => {
		expect(decodeThemeDrag(encodeThemeDrag("th-1"))).toEqual({ themeId: "th-1" })
	})

	it("returns null for anything that isn't a theme drag", () => {
		expect(decodeThemeDrag("")).toBeNull()
		expect(decodeThemeDrag("not json")).toBeNull()
		expect(decodeThemeDrag('{"visualIds":["v1"]}')).toBeNull()
	})
})
