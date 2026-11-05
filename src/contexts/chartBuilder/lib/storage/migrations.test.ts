import { describe, expect, it } from "vitest"

import { CONTENT_VERSION_COLLECTIONS } from "../../../../../server/src/contentVersionCollections"
import { stringifyJsonDangerous } from "../../../../lib/json"

import { pieceKey } from "../labelPieces"
import {
	annotationsMigrations,
	channelConfigsMigrations,
	clearLegacyAutoTickLabelAngle,
	CONTENT_MIGRATIONS,
	dataTableMigrations,
	dataLabelsConfigMigrations,
	datasetBodyMigrations,
	datasetsMigrations,
	measureFacetGapsFromPlotEdges,
	readThemeFontSizesV2,
	rebaseCustomGlyphRefs,
	resetVisualFontSizesV1ToV2,
	themesMigrations,
	visualsMigrations,
} from "./migrations"
import { CUSTOM_GLYPH_BASE } from "../customGlyphs"

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

describe("datasetBodyMigrations ↔ datasetsMigrations", () => {
	it("keeps the record-shaped steps derived from the per-body steps", () => {
		// The datasets store migrates at TWO shapes — the legacy whole-record
		// blob and the per-dataset body keys — so the record array must be a
		// per-entry mapping of the body array, step for step. If these ever
		// diverge, the next DATASETS_VERSION bump corrupts whichever shape
		// the new step wasn't written for.
		expect(datasetsMigrations).toHaveLength(datasetBodyMigrations.length)
		const legacy = {
			id: "ds-1",
			filename: "data.csv",
			fields: [{ name: "a", inferredType: "categorical" }],
			rows: [{ a: "x" }],
			createdAt: 1234,
		}
		expect(
			(datasetsMigrations[0]!({ "ds-1": legacy }) as Record<string, unknown>)[
				"ds-1"
			]
		).toEqual(datasetBodyMigrations[0]!(legacy))
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

describe("visualsMigrations v3 -> v4 (showNoDataRegions reset to true)", () => {
	const upgrade = visualsMigrations[3]!

	it("flips a saved visual's mapConfig.showNoDataRegions to true", () => {
		// The default flipped: regions absent from the dataset now paint with
		// the no-data fill. Saved visuals reset because their stored `false`
		// was overwhelmingly the old backfilled default, not a user choice.
		const out = upgrade([
			{
				id: "a",
				mapConfig: {
					coordSystem: "geographic",
					noDataFill: "#e7e5e4",
					showNoDataRegions: false,
				},
			},
		]) as Array<{ mapConfig: Record<string, unknown> }>
		expect(out[0]?.mapConfig.showNoDataRegions).toBe(true)
		// Every other mapConfig field is untouched.
		expect(out[0]?.mapConfig.coordSystem).toBe("geographic")
		expect(out[0]?.mapConfig.noDataFill).toBe("#e7e5e4")
	})

	it("leaves visuals without a mapConfig alone (restore-time default-merge covers them)", () => {
		expect(upgrade([{ id: "bare" }])).toEqual([{ id: "bare" }])
	})

	it("tolerates non-array input and non-object entries", () => {
		expect(upgrade("junk")).toBe("junk")
		expect(upgrade([null, "x"])).toEqual([null, "x"])
	})
})

describe("visualsMigrations v4 -> v5 (retired cartesian coordSystem folds into noMap)", () => {
	const upgrade = visualsMigrations[4]!

	it("rewrites an embedded mapConfig's coordSystem: \"cartesian\" to \"noMap\"", () => {
		const out = upgrade([
			{
				id: "a",
				mapConfig: {
					coordSystem: "cartesian",
					noDataFill: "#e7e5e4",
					showNoDataRegions: true,
				},
			},
		]) as Array<{ mapConfig: Record<string, unknown> }>
		expect(out[0]?.mapConfig.coordSystem).toBe("noMap")
		// Every other mapConfig field is untouched.
		expect(out[0]?.mapConfig.noDataFill).toBe("#e7e5e4")
		expect(out[0]?.mapConfig.showNoDataRegions).toBe(true)
	})

	it("leaves geographic and noMap coordSystems untouched", () => {
		const visuals = [
			{ id: "geo", mapConfig: { coordSystem: "geographic" } },
			{ id: "plain", mapConfig: { coordSystem: "noMap" } },
		]
		expect(upgrade(visuals)).toEqual(visuals)
	})

	it("leaves visuals without a mapConfig alone (restore-time default-merge covers them)", () => {
		expect(upgrade([{ id: "bare" }])).toEqual([{ id: "bare" }])
	})

	it("tolerates non-array input and non-object entries", () => {
		expect(upgrade("junk")).toBe("junk")
		expect(upgrade([null, "x"])).toEqual([null, "x"])
	})
})

describe("visualsMigrations v5 -> v6 (tickLabelAngle 0 → auto)", () => {
	const v5ToV6 = visualsMigrations[5]

	it("clears a stored 0 on x / y / r (the old auto) to absent, keeping the rest", () => {
		const out = v5ToV6([
			{
				id: "v1",
				channelConfigs: {
					x: { tickCount: 5, tickLabelAngle: 0 },
					y: { tickCount: 3, tickLabelAngle: 0, customFormat: ".1f" },
					r: { tickLabelAngle: 0 },
					hue: { kind: "categorical" },
				},
			},
		]) as Array<{ channelConfigs: Record<string, Record<string, unknown>> }>
		expect(out[0].channelConfigs.x).toEqual({ tickCount: 5 })
		expect(out[0].channelConfigs.y).toEqual({ tickCount: 3, customFormat: ".1f" })
		expect(out[0].channelConfigs.r).toEqual({})
		expect(out[0].channelConfigs.hue).toEqual({ kind: "categorical" })
	})

	it("keeps explicit non-zero angles and leaves the radar angle config alone", () => {
		const visual = {
			id: "v1",
			channelConfigs: {
				x: { tickLabelAngle: -30 },
				angle: { tickLabelAngle: 0, tickCount: 6 },
			},
		}
		const out = v5ToV6([visual]) as Array<typeof visual>
		expect(out[0].channelConfigs.x).toEqual({ tickLabelAngle: -30 })
		expect(out[0].channelConfigs.angle).toEqual({ tickLabelAngle: 0, tickCount: 6 })
		// Nothing to change → same reference (the helper is a no-op).
		expect(out[0]).toBe(visual)
	})

	it("is idempotent and tolerates sparse visuals / non-array input", () => {
		const once = v5ToV6([{ id: "a" }, { id: "b", channelConfigs: { x: { tickLabelAngle: 0 } } }])
		expect(v5ToV6(once)).toEqual(once)
		expect(v5ToV6("nope")).toBe("nope")
		expect(clearLegacyAutoTickLabelAngle(null)).toBe(null)
	})

	it("channelConfigs v1 -> v2 runs the same clear over the draft slice", () => {
		const v1ToV2 = channelConfigsMigrations[1]
		expect(v1ToV2({ x: { tickLabelAngle: 0 }, y: { tickLabelAngle: 15 } })).toEqual({
			x: {},
			y: { tickLabelAngle: 15 },
		})
		expect(v1ToV2(null)).toBe(null)
	})
})

describe("visualsMigrations v6 -> v7 (joined saved keys → structure)", () => {
	const v6ToV7 = visualsMigrations[6]!

	it("structures a col-only grid chart: pairs in every facet scope, nested per-panel bounds, pieces", () => {
		const out = v6ToV7([
			{
				id: "v1",
				encodings: { facetCol: { field: "System" } },
				channelConfigs: {
					facet: { panelAxisOverrides: { "__all__|Type of System": { yMin: 0 } } },
				},
				dataLabelsConfig: {
					facetKeys: ["__all__|Type of System"],
					fieldFonts: { [pieceKey("lbl", "Region")]: { fontWeight: 700 } },
				},
				annotationsConfig: {
					rectangles: [{ id: "r", facetKeys: ["__all__|Type of System"] }],
					circles: [],
					lineSegments: [],
					texts: [],
				},
			},
		]) as Array<Record<string, any>>
		expect(out[0].channelConfigs.facet).toEqual({
			panelAxisOverrides: {},
			gridPanelAxisOverrides: { __all__: { "Type of System": { yMin: 0 } } },
		})
		expect(out[0].dataLabelsConfig).toEqual({
			facetKeys: [{ row: "__all__", col: "Type of System" }],
			fieldFonts: {},
			pieces: { lbl: { Region: { font: { fontWeight: 700 } } } },
		})
		expect(out[0].annotationsConfig.rectangles[0].facetKeys).toEqual([
			{ row: "__all__", col: "Type of System" },
		])
	})

	it("accepts already-structured visuals unchanged (a partly written server migration retries over them)", () => {
		const structured = {
			id: "v2",
			encodings: { facetRow: { field: "r" } },
			dataLabelsConfig: { facetKeys: [{ row: "a", col: "__all__" }] },
		}
		const out = v6ToV7([structured]) as unknown[]
		expect(out[0]).toBe(structured)
		expect(v6ToV7(out)).toEqual(out)
	})

	it("tolerates sparse visuals and non-array input", () => {
		expect(v6ToV7([{ id: "a" }, null])).toEqual([{ id: "a" }, null])
		expect(v6ToV7("nope")).toBe("nope")
	})

	it("the draft slices run the same step: dataLabelsConfig v1→v2, annotations v4→v5, channelConfigs v2→v3", () => {
		expect(
			dataLabelsConfigMigrations[1]!({
				fieldSizes: { [pieceKey("l", "a")]: 9 },
				facetKeys: ["x|__all__"],
			})
		).toEqual({
			fieldSizes: {},
			pieces: { l: { a: { size: 9 } } },
			facetKeys: [{ row: "x", col: "__all__" }],
		})
		expect(
			annotationsMigrations[4]!({
				rectangles: [{ facetKeys: ["__all__|c"] }],
				circles: [],
				lineSegments: [],
				texts: [],
			})
		).toEqual({
			rectangles: [{ facetKeys: [{ row: "__all__", col: "c" }] }],
			circles: [],
			lineSegments: [],
			texts: [],
		})
		expect(
			channelConfigsMigrations[2]!({
				facet: { panelAxisOverrides: { "__all__|c": { xMin: 1 }, wrap: { xMin: 2 } } },
			})
		).toEqual({
			facet: {
				panelAxisOverrides: { wrap: { xMin: 2 } },
				gridPanelAxisOverrides: { __all__: { c: { xMin: 1 } } },
			},
		})
		// A slice loads without the encodings, so a full-grid key it can't
		// tell from a wrap value stays until the next save structures the
		// whole visual.
		expect(channelConfigsMigrations[2]!({ facet: { panelAxisOverrides: { "a|b": {} } } })).toEqual({
			facet: { panelAxisOverrides: { "a|b": {} } },
		})
		expect(dataLabelsConfigMigrations[1]!(null)).toBeNull()
		expect(annotationsMigrations[4]!(null)).toBeNull()
		expect(channelConfigsMigrations[2]!(null)).toBeNull()
	})
})

describe("visualsMigrations v7 -> v8 (facet gaps measured plot edge to plot edge)", () => {
	const upgrade = visualsMigrations[7]!

	it("shifts stored gaps by 30 and stamps the marker, keeping the rest", () => {
		const [out] = upgrade([
			{
				id: "v",
				channelConfigs: { facet: { gapX: 30, gapY: -20, rows: 2 }, other: 1 },
			},
		]) as Array<{ channelConfigs: Record<string, unknown> }>
		expect(out!.channelConfigs).toEqual({
			facet: { gapX: 60, gapY: 10, rows: 2, gapsFrom: "plot" },
			other: 1,
		})
	})

	it("leaves an absent gap absent (the new default moved by the same 30)", () => {
		const [out] = upgrade([{ channelConfigs: { facet: { gapY: 0 } } }]) as Array<{
			channelConfigs: { facet: Record<string, unknown> }
		}>
		expect(out!.channelConfigs.facet).toEqual({ gapY: 30, gapsFrom: "plot" })
	})

	it("is idempotent: a marked config comes back as the same reference", () => {
		const visual = { channelConfigs: { facet: { gapX: 5, gapsFrom: "plot" } } }
		expect(measureFacetGapsFromPlotEdges(visual)).toBe(visual)
		const once = measureFacetGapsFromPlotEdges({ channelConfigs: { facet: { gapX: 5 } } })
		expect(measureFacetGapsFromPlotEdges(once)).toBe(once)
	})

	it("tolerates sparse visuals and non-array input", () => {
		const sparse = { id: "s" }
		expect(upgrade([sparse, null])).toEqual([sparse, null])
		expect(upgrade("nope")).toBe("nope")
	})

	it("channelConfigs v3 -> v4 runs the same step over the draft slice", () => {
		expect(channelConfigsMigrations[3]!({ facet: { gapX: 0 } })).toEqual({
			facet: { gapX: 30, gapsFrom: "plot" },
		})
	})
})

describe("visuals v8 -> v9: custom-glyph shape references rebase onto the fixed base", () => {
	const upgrade = visualsMigrations[8]!

	it("moves the old custom range [6, 1000) up to CUSTOM_GLYPH_BASE, built-ins untouched", () => {
		const [out] = upgrade([
			{
				id: "v",
				channelConfigs: {
					defaultShape: 6,
					shape: { overrides: { East: 2, West: 7, North: 6 }, outlineWidth: 1 },
					other: 1,
				},
			},
		]) as Array<{ channelConfigs: Record<string, unknown> }>
		expect(out!.channelConfigs).toEqual({
			defaultShape: CUSTOM_GLYPH_BASE,
			shape: {
				overrides: { East: 2, West: CUSTOM_GLYPH_BASE + 1, North: CUSTOM_GLYPH_BASE },
				outlineWidth: 1,
			},
			other: 1,
		})
	})

	it("is idempotent: rebased or built-in-only configs come back as the same reference", () => {
		const rebased = {
			channelConfigs: { defaultShape: CUSTOM_GLYPH_BASE, shape: { overrides: { a: 3 } } },
		}
		expect(rebaseCustomGlyphRefs(rebased)).toBe(rebased)
		const builtIns = { channelConfigs: { defaultShape: 5, shape: { overrides: { a: 0 } } } }
		expect(rebaseCustomGlyphRefs(builtIns)).toBe(builtIns)
		const once = rebaseCustomGlyphRefs({ channelConfigs: { defaultShape: 8 } })
		expect(rebaseCustomGlyphRefs(once)).toBe(once)
	})

	it("tolerates sparse visuals and non-array input", () => {
		const sparse = { id: "s" }
		const noShape = { channelConfigs: { x: {} } }
		expect(upgrade([sparse, null, noShape])).toEqual([sparse, null, noShape])
		expect(upgrade("nope")).toBe("nope")
	})

	it("channelConfigs v4 -> v5 runs the same step over the draft slice", () => {
		expect(
			channelConfigsMigrations[4]!({ defaultShape: 7, shape: { overrides: { a: 6 } } })
		).toEqual({
			defaultShape: CUSTOM_GLYPH_BASE + 1,
			shape: { overrides: { a: CUSTOM_GLYPH_BASE } },
		})
		expect(channelConfigsMigrations[4]!(null)).toBeNull()
	})
})

describe("visuals v9 -> v10: data-table style defaults start following the theme", () => {
	const upgrade = visualsMigrations[9]!

	it("clears the backfilled true / true / right, keeps real choices", () => {
		const backfilled = {
			id: "a",
			dataTableConfig: {
				enabled: false,
				headerBold: true,
				striped: true,
				numberAlign: "right",
				textColor: "#123456",
			},
		}
		const chosen = {
			id: "b",
			dataTableConfig: { headerBold: false, striped: false, numberAlign: "center" },
		}
		const [a, b] = upgrade([backfilled, chosen]) as Array<{
			dataTableConfig: Record<string, unknown>
		}>
		expect(a!.dataTableConfig).toMatchObject({
			enabled: false,
			striped: null,
			numberAlign: null,
			textColor: "#123456",
		})
		// Bold on follows the theme's header weight; off pins the 400 it drew at.
		expect(a!.dataTableConfig).not.toHaveProperty("headerBold")
		expect(a!.dataTableConfig).not.toHaveProperty("headerFontWeight")
		expect(b!.dataTableConfig).toMatchObject({
			headerFontWeight: 400,
			striped: false,
			numberAlign: "center",
		})
		expect(b!.dataTableConfig).not.toHaveProperty("headerBold")
	})

	it("is idempotent and leaves visuals without a table config alone", () => {
		const once = upgrade([{ id: "a", dataTableConfig: { headerBold: true } }])
		expect(upgrade(once)).toEqual(once)
		const bare = { id: "c" }
		expect(upgrade([bare, null])).toEqual([bare, null])
		expect(upgrade("nope")).toBe("nope")
	})

	it("moves the old caption (the text above the table) to the title", () => {
		const [moved] = upgrade([
			{ dataTableConfig: { caption: "Sales", captionFontWeight: 700, captionAlign: "center" } },
		]) as Array<{ dataTableConfig: Record<string, unknown> }>
		expect(moved!.dataTableConfig).toMatchObject({
			title: "Sales",
			titleFontWeight: 700,
			titleAlign: "center",
			caption: null,
			captionFontWeight: null,
			captionAlign: null,
		})
		// Already split: a real caption stays put.
		const split = { dataTableConfig: { title: null, caption: "Source: survey" } }
		expect(upgrade([split])).toEqual([split])
	})

	it("dataTable v1 -> v2 runs the same step over the draft slice", () => {
		expect(
			dataTableMigrations[1]!({ headerBold: true, striped: false, numberAlign: "right" })
		).toMatchObject({ striped: false, numberAlign: null, title: null })
		expect(dataTableMigrations[1]!(null)).toBeNull()
	})
})

describe("visuals v10 -> v11: data-table Max rows defaults to 10", () => {
	const upgrade = visualsMigrations[10]!

	it("fills the backfilled null, keeps a set count and visuals without a table", () => {
		const bare = { id: "c" }
		const [a, b, c] = upgrade([
			{ id: "a", dataTableConfig: { enabled: true, maxRows: null } },
			{ id: "b", dataTableConfig: { maxRows: 25 } },
			bare,
		]) as Array<{ dataTableConfig?: Record<string, unknown> }>
		expect(a!.dataTableConfig).toEqual({ enabled: true, maxRows: 10 })
		expect(b!.dataTableConfig).toEqual({ maxRows: 25 })
		expect(c).toBe(bare)
		expect(upgrade("nope")).toBe("nope")
	})

	it("dataTable v2 -> v3 runs the same step over the draft slice", () => {
		expect(dataTableMigrations[2]!({ maxRows: null })).toEqual({ maxRows: 10 })
		expect(dataTableMigrations[2]!(null)).toBeNull()
	})
})

describe("CONTENT_MIGRATIONS", () => {
	// Migration N upgrades vN to vN+1, so reaching `currentVersion` needs
	// exactly that many steps. This is the guard against the failure mode the
	// registry exists for: bumping a version and forgetting that server-stored
	// data now needs a step to get there.
	it("has one migration per version for every collection", () => {
		for (const [collection, spec] of Object.entries(CONTENT_MIGRATIONS)) {
			expect(
				{ collection, steps: spec.migrations.length },
				`${collection} has ${spec.migrations.length} migrations for v${spec.currentVersion}`
			).toEqual({ collection, steps: spec.currentVersion })
		}
	})

	// The server only accepts stamp writes for the collections in its own
	// whitelist (CONTENT_VERSION_COLLECTIONS); a collection registered here
	// but missing there 404s on the stamp write, and one present there but
	// missing here never gets migrated. Importing the server's list keeps
	// the two from drifting. `folders` is absent from both because folders
	// are unversioned.
	it("covers exactly the server's versioned collections", () => {
		expect(Object.keys(CONTENT_MIGRATIONS).sort()).toEqual(
			[...CONTENT_VERSION_COLLECTIONS].sort()
		)
	})
})

describe("visuals v11 -> v12: legacy pattern tile color / default ink follow the mark", () => {
	const upgrade = visualsMigrations[11]!

	it("nulls the theme-seeded gray tile and the theme-seeded ink, keeps real picks", () => {
		const seeded = {
			id: "a",
			channelConfigs: {
				patternInkColor: "#000000",
				defaultPatternInk: "#000000",
				pattern: { overrides: {}, backgroundColor: "#EFEFEF", stackMode: "stack" },
			},
		}
		const builtIn = { id: "b", channelConfigs: { pattern: { backgroundColor: "#e2e8f0" } } }
		const chosen = {
			id: "c",
			channelConfigs: {
				patternInkColor: "#000000",
				defaultPatternInk: "#ff0000",
				pattern: { backgroundColor: "#abcdef" },
			},
		}
		const bare = { id: "d" }
		const [a, b, c, d] = upgrade([seeded, builtIn, chosen, bare, null]) as Array<{
			channelConfigs?: Record<string, unknown>
		}>
		expect(a!.channelConfigs).toEqual({
			patternInkColor: "#000000",
			defaultPatternInk: null,
			pattern: { overrides: {}, backgroundColor: null, stackMode: "stack" },
		})
		expect(b!.channelConfigs).toEqual({ pattern: { backgroundColor: null } })
		expect(c).toBe(chosen)
		expect(d).toBe(bare)
		expect(upgrade("nope")).toBe("nope")
	})

	it("is idempotent", () => {
		const once = upgrade([
			{ channelConfigs: { defaultPatternInk: "#000", patternInkColor: "#000", pattern: { backgroundColor: "#efefef" } } },
		])
		expect(upgrade(once)).toEqual(once)
	})

	it("channelConfigs v5 -> v6 runs the same step over the draft slice", () => {
		expect(
			channelConfigsMigrations[5]!({ pattern: { backgroundColor: "#EFEFEF" }, defaultPatternInk: "#111", patternInkColor: "#111" })
		).toEqual({ pattern: { backgroundColor: null }, defaultPatternInk: null, patternInkColor: "#111" })
		const kept = { pattern: { backgroundColor: "#abcdef" } }
		expect(channelConfigsMigrations[5]!(kept)).toBe(kept)
		expect(channelConfigsMigrations[5]!(null)).toBeNull()
	})
})

describe("themes v2 -> v3: the former system pattern Background follows the mark", () => {
	const upgrade = themesMigrations[2]!

	it("nulls #EFEFEF, keeps any other color and null", () => {
		const legacy = { id: "t1", patternBackgroundColor: "#EFEFEF" }
		const chosen = { id: "t2", patternBackgroundColor: "#abcdef" }
		const already = { id: "t3", patternBackgroundColor: null }
		const [a, b, c] = upgrade([legacy, chosen, already, null]) as Array<Record<string, unknown>>
		expect(a).toEqual({ id: "t1", patternBackgroundColor: null })
		expect(b).toBe(chosen)
		expect(c).toBe(already)
		expect(upgrade("nope")).toBe("nope")
	})
})

describe("radar spine slots fold into the angle spine (visuals v12 -> v13, channelConfigs v6 -> v7)", () => {
	const LEGACY = {
		angle: { minAngle: 0, spine: { color: "#cccccc", thickness: 2 } },
		colorSlots: {
			spine: { field: null, singleColor: "#ff0000" },
			line: { field: null, singleColor: "#00ff00" },
		},
		opacitySlots: { spine: { field: null, level: 0.4 } },
	}

	it("moves the slot color / level onto angle.spine and drops the slots", () => {
		const out = channelConfigsMigrations[6]!(LEGACY) as typeof LEGACY & {
			angle: { spine: { opacity?: number } }
		}
		expect(out.angle).toEqual({
			minAngle: 0,
			spine: { color: "#ff0000", thickness: 2, opacity: 0.4 },
		})
		expect(out.colorSlots).toEqual({ line: { field: null, singleColor: "#00ff00" } })
		expect(out.opacitySlots).toEqual({})
	})

	it("leaves an opacity level of 1 absent", () => {
		const out = channelConfigsMigrations[6]!({
			opacitySlots: { spine: { field: null, level: 1 } },
		}) as Record<string, unknown>
		expect(out.angle).toBeUndefined()
		expect(out.opacitySlots).toEqual({})
	})

	it("is idempotent and returns the same reference when there's nothing to fold", () => {
		const clean = { angle: { spine: { color: "#123456", thickness: 1 } } }
		expect(channelConfigsMigrations[6]!(clean)).toBe(clean)
		const once = channelConfigsMigrations[6]!(LEGACY)
		expect(channelConfigsMigrations[6]!(once)).toBe(once)
	})

	it("runs over saved visuals", () => {
		const [vis] = visualsMigrations[12]!([{ id: "v", channelConfigs: LEGACY }]) as Array<{
			channelConfigs: { angle: { spine: { color: string } }; colorSlots: object }
		}>
		expect(vis!.channelConfigs.angle.spine.color).toBe("#ff0000")
		expect(vis!.channelConfigs.colorSlots).not.toHaveProperty("spine")
	})
})
