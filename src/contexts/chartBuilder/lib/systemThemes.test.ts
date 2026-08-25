import { beforeEach, describe, expect, it } from "vitest"
import { createStore } from "jotai"

import {
	LIGHT_THEME_BASE,
	normalizeSavedTheme,
	normalizeSavedThemes,
	SYSTEM_DARK_THEME,
	SYSTEM_LIGHT_THEME,
	themeOf,
} from "./systemThemes"
import type { SavedTheme } from "./types"
import { saveThemes } from "./storage"
import { themesAtom } from "../store/atoms"
import { installInMemoryLocalStorage } from "../../../testSupport/localStorageShim"

/** A custom theme as an OLD build would have persisted it: cloned from the
 * dark system theme back when several of today's `Theme` fields didn't exist
 * yet. The dark-differing values are explicit (they've existed since the dark
 * theme shipped); the stripped fields are ones added to `LIGHT_THEME_BASE`
 * later, which a stored blob from that era simply doesn't carry. */
const sparseDarkClone = (): SavedTheme => {
	const full: SavedTheme = {
		...SYSTEM_DARK_THEME,
		id: "th-old-dark",
		name: "My dark theme",
		isSystem: false,
	}
	const raw = full as unknown as Record<string, unknown>
	// Added to LIGHT_THEME_BASE after this theme's era.
	delete raw.dataLabelsFontSize
	delete raw.dataLabelsFontWeight
	delete raw.dataLabelsItalic
	delete raw.dataLabelsUnderline
	// The field from the original bug report (a pre-extraction-era theme
	// missing it made NumberInputs drop to their min).
	delete raw.textEncodingFontSize
	return raw as unknown as SavedTheme
}

describe("themeOf", () => {
	it("backfills fields the saved theme is missing from the light base", () => {
		const t = themeOf(sparseDarkClone())
		expect(t.textEncodingFontSize).toBe(LIGHT_THEME_BASE.textEncodingFontSize)
		expect(t.dataLabelsFontSize).toBe(LIGHT_THEME_BASE.dataLabelsFontSize)
	})

	it("never overrides values the saved theme carries", () => {
		const t = themeOf(sparseDarkClone())
		// Dark-derived values survive the light-base backfill.
		expect(t.chartBackgroundColor).toBe("#0f172a")
		expect(t.legendSwatchColor).toBe("#7aa8e8")
		expect(t.textEncodingColor).toBe("#f8fafc")
	})
})

describe("normalizeSavedTheme", () => {
	it("keeps identity, keeps explicit values, backfills missing fields", () => {
		const n = normalizeSavedTheme(sparseDarkClone())
		expect(n.id).toBe("th-old-dark")
		expect(n.name).toBe("My dark theme")
		expect(n.isSystem).toBe(false)
		expect(n.chartBackgroundColor).toBe("#0f172a")
		expect(n.textEncodingFontSize).toBe(LIGHT_THEME_BASE.textEncodingFontSize)
		expect(n.dataLabelsFontWeight).toBe(LIGHT_THEME_BASE.dataLabelsFontWeight)
	})

	it("leaves OPTIONAL fields absent — their fallbacks belong to consumers", () => {
		const n = normalizeSavedTheme(sparseDarkClone())
		// e.g. annotation seeds / map leader lines: `undefined` means "use the
		// built-in default", which per-consumer `??` fallbacks own. Inventing
		// values here would freeze today's defaults into every old theme.
		expect(n.annotationFillColor).toBeUndefined()
		expect(n.mapLeaderLineColor).toBeUndefined()
		expect(n.titleFontWeight).toBeUndefined()
	})
})

describe("normalizeSavedThemes", () => {
	it("re-stamps stored system entries from the bundled copies", () => {
		const staleSystemLight = {
			...SYSTEM_LIGHT_THEME,
		} as unknown as Record<string, unknown>
		delete staleSystemLight.dataLabelsFontSize
		delete staleSystemLight.legendSwatchStroke
		const out = normalizeSavedThemes([
			staleSystemLight as unknown as SavedTheme,
			sparseDarkClone(),
		])
		expect(out[0]).toEqual(SYSTEM_LIGHT_THEME)
		expect(out[1]!.id).toBe("th-old-dark")
		expect(out[1]!.textEncodingFontSize).toBe(
			LIGHT_THEME_BASE.textEncodingFontSize
		)
	})
})

describe("themesAtom rehydration", () => {
	beforeEach(() => {
		installInMemoryLocalStorage()
	})

	it("loads a persisted sparse custom theme with every base field resolved", () => {
		saveThemes([SYSTEM_LIGHT_THEME, SYSTEM_DARK_THEME, sparseDarkClone()])
		const store = createStore()
		const themes = store.get(themesAtom)
		const mine = themes.find((t) => t.id === "th-old-dark")
		expect(mine).toBeDefined()
		// The values `useCurrentTheme` / `useResetVisual` read straight off the
		// atom entry — sparse persistence must never surface as `undefined`.
		expect(mine!.textEncodingFontSize).toBe(
			LIGHT_THEME_BASE.textEncodingFontSize
		)
		expect(mine!.dataLabelsFontSize).toBe(LIGHT_THEME_BASE.dataLabelsFontSize)
		// The user's dark-derived choices are untouched.
		expect(mine!.chartBackgroundColor).toBe("#0f172a")
		expect(mine!.legendBackgroundColor).toBe("#1f2937")
	})

	it("keeps inserting missing system themes ahead of user themes", () => {
		saveThemes([sparseDarkClone()])
		const store = createStore()
		const themes = store.get(themesAtom)
		expect(themes.map((t) => t.id)).toEqual([
			"system-light",
			"system-dark",
			"th-old-dark",
		])
	})
})
