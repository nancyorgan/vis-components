import { describe, expect, it } from "vitest"

import { stringifyJsonDangerous } from "../../../../lib/json"

import {
	datasetsMigrations,
	readThemeFontSizesV2,
	resetVisualFontSizesV1ToV2,
	visualsMigrations,
} from "./migrations"

/** Migration tests for the two non-identity migration arrays.
 *
 *  The other migration arrays are `identityMigrations`, which is just
 *  `[(raw) => raw]` — trivially correct, not worth a dedicated test. */

describe("visualsMigrations v0 -> v1", () => {
	const upgrade = visualsMigrations[0]!

	it("returns [] when the stored value isn't an array (corruption guard)", () => {
		// Indirect undefined so unicorn/no-useless-undefined doesn't flag
		// the literal — the migration's tolerance for undefined input is
		// part of its contract.
		const explicitUndefined: unknown = void 0
		expect(upgrade(null)).toEqual([])
		expect(upgrade(explicitUndefined)).toEqual([])
		expect(upgrade({})).toEqual([])
		expect(upgrade("not an array")).toEqual([])
	})

	it("backfills createdAtVersionId on visuals missing it", () => {
		const result = upgrade([{ id: "a", name: "vis a" }]) as Array<
			Record<string, unknown>
		>
		expect(result[0]).toHaveProperty("createdAtVersionId", null)
	})

	it("leaves createdAtVersionId alone when present (even if null)", () => {
		const result = upgrade([
			{ id: "a", name: "vis a", createdAtVersionId: "dv-1" },
			{ id: "b", name: "vis b", createdAtVersionId: null },
		]) as Array<Record<string, unknown>>
		expect(result[0]?.createdAtVersionId).toBe("dv-1")
		expect(result[1]?.createdAtVersionId).toBe(null)
	})

	it("scrubs defaultSaturation=1 to null (the historic Reset-button trap)", () => {
		const result = upgrade([
			{
				id: "a",
				channelConfigs: {
					defaultSaturation: 1,
					defaultBrightness: 0.5,
				},
			},
		]) as Array<{ channelConfigs: Record<string, unknown> }>
		expect(result[0]?.channelConfigs.defaultSaturation).toBeNull()
		expect(result[0]?.channelConfigs.defaultBrightness).toBeNull()
	})

	it("keeps defaultSaturation/defaultBrightness at non-trap values", () => {
		const result = upgrade([
			{
				id: "a",
				channelConfigs: {
					defaultSaturation: 0.6,
					defaultBrightness: 0.42,
				},
			},
		]) as Array<{ channelConfigs: Record<string, unknown> }>
		expect(result[0]?.channelConfigs.defaultSaturation).toBe(0.6)
		expect(result[0]?.channelConfigs.defaultBrightness).toBe(0.42)
	})

	it("is idempotent on already-v1 data (running again leaves it unchanged)", () => {
		const v1 = [
			{
				id: "a",
				name: "vis a",
				createdAtVersionId: null,
				channelConfigs: { defaultSaturation: 0.6 },
			},
		]
		const once = upgrade(v1)
		const twice = upgrade(once)
		expect(twice).toEqual(once)
	})
})

describe("datasetsMigrations v0 -> v1", () => {
	const upgrade = datasetsMigrations[0]!

	it("returns {} when the stored value isn't an object", () => {
		const explicitUndefined: unknown = void 0
		expect(upgrade(null)).toEqual({})
		expect(upgrade(explicitUndefined)).toEqual({})
		expect(upgrade(42)).toEqual({})
	})

	it("wraps a legacy single-version dataset into the modern shape", () => {
		const legacy = {
			"ds-1": {
				id: "ds-1",
				filename: "data.csv",
				fields: [{ name: "a", inferredType: "categorical" }],
				rows: [{ a: "x" }, { a: "y" }],
				createdAt: 1234,
			},
		}
		const result = upgrade(legacy) as Record<string, unknown>
		const ds = result["ds-1"] as {
			id: string
			name: string
			versions: Array<{ id: string; filename: string; rows: unknown[] }>
			latestVersionId: string
			createdAt: number
		}
		expect(ds.id).toBe("ds-1")
		expect(ds.name).toBe("data.csv")
		expect(ds.versions.length).toBe(1)
		expect(ds.versions[0]?.filename).toBe("data.csv")
		expect(ds.versions[0]?.rows).toEqual([{ a: "x" }, { a: "y" }])
		expect(ds.latestVersionId).toBe(ds.versions[0]?.id)
	})

	it("leaves a modern dataset (already has `versions`) untouched", () => {
		const modern = {
			"ds-1": {
				id: "ds-1",
				name: "named",
				fields: [],
				versions: [{ id: "dv-1", filename: "v1.csv", rows: [], createdAt: 1 }],
				latestVersionId: "dv-1",
				createdAt: 1,
			},
		}
		const result = upgrade(modern) as Record<string, unknown>
		expect(result["ds-1"]).toEqual(modern["ds-1"])
	})

	it("handles a mixed bag of legacy and modern in one call", () => {
		const mixed = {
			"ds-legacy": {
				id: "ds-legacy",
				filename: "old.csv",
				fields: [],
				rows: [{ a: "x" }],
				createdAt: 1,
			},
			"ds-modern": {
				id: "ds-modern",
				name: "modern",
				fields: [],
				versions: [{ id: "dv-m", filename: "m.csv", rows: [], createdAt: 2 }],
				latestVersionId: "dv-m",
				createdAt: 2,
			},
		}
		const result = upgrade(mixed) as Record<
			string,
			{ name: string; versions: unknown[] }
		>
		// Legacy got wrapped (name derived from filename).
		expect(result["ds-legacy"]?.name).toBe("old.csv")
		// Modern stayed as-is.
		expect(result["ds-modern"]?.name).toBe("modern")
	})
})

describe("visualsMigrations v1 -> v2 (font sizes reset to theme after px→pt)", () => {
	const upgrade = visualsMigrations[1]!

	/** Themes storage shim (mirrors versioning.test's makeStorage): the
	 *  reader is injectable, so tests never touch global localStorage. */
	const themesFrom = (themes: Array<Record<string, unknown>>) =>
		readThemeFontSizesV2({
			getItem: (k: string) =>
				k === "vis-components:themes"
					? stringifyJsonDangerous({ _v: 2, data: themes } as never)
					: null,
		})

	const customTheme = {
		id: "custom-theme",
		titlePrimarySize: 18,
		titleSubtitleSize: 13,
		titleSecondarySize: 12,
		textFontSize: 11,
		textEncodingFontSize: 10,
	}

	const visual = (over: Record<string, unknown> = {}) => ({
		id: "a",
		name: "vis a",
		themeId: "custom-theme",
		labelsConfig: {
			baseFont: {
				titles: {
					family: "serif",
					color: "#111",
					primarySize: 24,
					subtitleSize: 16,
					secondarySize: 15,
					weight: 600,
				},
				text: { family: "serif", size: 15, color: "#222" },
			},
			fontOverrides: {
				title: { size: 30, color: "#f00" },
				subtitle: { size: 18 },
			},
		},
		channelConfigs: {
			x: { tickCount: 5, tickLabelFont: { size: 9, color: "#0a0" } },
			y: { tickLabelFont: { size: 10 } },
			connection: { chordAxis: { enabled: true, tickLabelFont: { size: 8 } } },
			text: { fontSize: 14, fontFamily: "serif" },
		},
		dataLabelsConfig: { fontSize: 16, sizeMin: 6, sizeMax: 30 },
		captionConfig: { enabled: true, text: "cap", fontSize: 17 },
		annotationsConfig: {
			rectangles: [{ id: "r1", text: "note", textFontSize: 22, textColor: "#333" }],
		},
		...over,
	})

	const reset = (v: Record<string, unknown>, themes = themesFrom([customTheme])) =>
		resetVisualFontSizesV1ToV2(v, themes) as Record<string, any>

	it("parses the versioned themes envelope (and the bare legacy array)", () => {
		expect(themesFrom([customTheme]).get("custom-theme")?.titlePrimarySize).toBe(18)
		const legacy = readThemeFontSizesV2({
			getItem: () => stringifyJsonDangerous([customTheme] as never),
		})
		expect(legacy.get("custom-theme")?.textFontSize).toBe(11)
		// Unreadable storage → empty map, no throw.
		expect(
			readThemeFontSizesV2({
				getItem: () => {
					throw new Error("boom")
				},
			}).size
		).toBe(0)
	})

	it("resets base font sizes to the visual's theme and keeps non-size styling", () => {
		const v = reset(visual())
		const titles = v.labelsConfig.baseFont.titles
		expect(titles.primarySize).toBe(18)
		expect(titles.subtitleSize).toBe(13)
		expect(titles.secondarySize).toBe(12)
		expect(titles.family).toBe("serif")
		expect(titles.weight).toBe(600)
		expect(v.labelsConfig.baseFont.text.size).toBe(11)
		expect(v.channelConfigs.text.fontSize).toBe(10)
		expect(v.channelConfigs.text.fontFamily).toBe("serif")
	})

	it("strips per-label and per-axis size overrides, keeping other fields", () => {
		const v = reset(visual())
		// title kept its color, lost its size; subtitle became empty → dropped.
		expect(v.labelsConfig.fontOverrides.title).toEqual({ color: "#f00" })
		expect(v.labelsConfig.fontOverrides.subtitle).toBeUndefined()
		expect(v.channelConfigs.x.tickLabelFont).toEqual({ color: "#0a0" })
		expect(v.channelConfigs.x.tickCount).toBe(5)
		// y's override was size-only → dropped entirely.
		expect(v.channelConfigs.y.tickLabelFont).toBeUndefined()
		expect(v.channelConfigs.connection.chordAxis.tickLabelFont).toBeUndefined()
		expect(v.channelConfigs.connection.chordAxis.enabled).toBe(true)
	})

	it("resets fixed data-label / caption / annotation text sizes", () => {
		const v = reset(visual())
		expect(v.dataLabelsConfig.fontSize).toBe(11)
		// sizeMin/sizeMax survive (inert while size isn't encoded).
		expect(v.dataLabelsConfig.sizeMin).toBe(6)
		expect(v.dataLabelsConfig.sizeMax).toBe(30)
		expect(v.captionConfig.fontSize).toBe(13)
		expect(v.captionConfig.text).toBe("cap")
		expect(v.annotationsConfig.rectangles[0].textFontSize).toBeUndefined()
		expect(v.annotationsConfig.rectangles[0].textColor).toBe("#333")
	})

	it("resets data-label size to the theme's dataLabelsFontSize when set", () => {
		const v = reset(
			visual(),
			themesFrom([{ ...customTheme, dataLabelsFontSize: 9 }])
		)
		expect(v.dataLabelsConfig.fontSize).toBe(9)
	})

	it("leaves data-label sizes alone when size is encoded to a variable", () => {
		const byField = reset(
			visual({ dataLabelsEncodings: { size: { field: "Value" } } })
		)
		const byDepth = reset(
			visual({
				dataLabelsEncodings: { size: { field: null, measureSource: "depth" } },
			})
		)
		expect(byField.dataLabelsConfig).toEqual({
			fontSize: 16,
			sizeMin: 6,
			sizeMax: 30,
		})
		expect(byDepth.dataLabelsConfig).toEqual({
			fontSize: 16,
			sizeMin: 6,
			sizeMax: 30,
		})
	})

	it("falls back to the light system sizes when the themeId doesn't resolve", () => {
		const v = reset(visual({ themeId: "gone" }), new Map())
		expect(v.labelsConfig.baseFont.titles.primarySize).toBe(20)
		expect(v.labelsConfig.baseFont.titles.subtitleSize).toBe(14)
		expect(v.labelsConfig.baseFont.titles.secondarySize).toBe(13)
		expect(v.labelsConfig.baseFont.text.size).toBe(12)
		expect(v.channelConfigs.text.fontSize).toBe(11)
	})

	it("resets the legacy flat-font shape via its single size", () => {
		const v = reset(
			visual({ labelsConfig: { font: { family: "serif", size: 18 } } })
		)
		expect(v.labelsConfig.font.size).toBe(11)
		expect(v.labelsConfig.font.family).toBe("serif")
	})

	it("tolerates sparse visuals (no configs at all) and non-array input", () => {
		expect(reset({ id: "bare" })).toEqual({ id: "bare" })
		expect(upgrade("junk")).toBe("junk")
	})

	it("v2 -> v3 re-runs the same reset (heals a v2 pass that baked stale theme sizes)", () => {
		const rerun = visualsMigrations[2]!
		// A "v2" visual whose sizes were baked from a stale theme (15), while
		// the CURRENT theme says 12 — exactly the mid-retune upgrade case.
		const stale = visual()
		const out = rerun([stale]) as Array<Record<string, any>>
		// No localStorage in this env → fallback sizes (the point is that the
		// reset ran again at all; theme-resolution is covered above).
		expect(out[0].labelsConfig.baseFont.text.size).toBe(12)
	})

	it("is idempotent (second run is a no-op)", () => {
		const themes = themesFrom([customTheme])
		const once = resetVisualFontSizesV1ToV2(visual(), themes)
		const twice = resetVisualFontSizesV1ToV2(once, themes)
		expect(twice).toEqual(once)
	})
})
