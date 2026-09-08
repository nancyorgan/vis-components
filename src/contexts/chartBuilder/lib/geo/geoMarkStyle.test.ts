import type { Feature } from "geojson"
import { describe, expect, it } from "vitest"

import type { AestheticScales } from "../../store/useAestheticScales"
import { EMPTY_CHANNEL_CONFIGS } from "../channelConfig"
import { makeHueScale, makeOpacityScale, type UnitScale } from "../scales"
import {
	OPACITY_BASE_FILL,
	buildGeoPatternDefs,
	buildRegionStyleResolvers,
	geoPatternFill,
	resolveGeoFill,
	resolveGeoOutlineColor,
	resolveGeoPatternDef,
	resolveNoDataPatternDef,
} from "./geoMarkStyle"

// A categorical hue scale over A/B/C — applyHueScale maps a raw value to a
// palette color; we only assert it differs from the base fill (the exact
// palette color is the responsibility of scales.test.ts).
const hueOver = (values: string[]): AestheticScales["hue"] => ({
	scale: makeHueScale(values, "categorical"),
	field: { name: "cat", type: "categorical" },
})

const opacityOver = (values: number[]): AestheticScales["opacity"] => ({
	scale: makeOpacityScale(values, "quantitative") as UnitScale,
	field: { name: "n", type: "quantitative" },
})

/** A unit scale over `values` on column `b` — sat/bri channels take one. */
const unitOver = (
	values: number[],
	name: string
): AestheticScales["brightness"] => ({
	scale: makeOpacityScale(values, "quantitative") as UnitScale,
	field: { name, type: "quantitative" },
})

const EMPTY_SCALES: AestheticScales = {
	hue: null,
	outlineHue: null,
	saturation: null,
	brightness: null,
	pattern: null,
	colorSlots: {},
	opacitySlots: {},
	opacity: null,
	area: null,
	shape: null,
	length: null,
	angle: null,
}

/** `EMPTY_SCALES` with the named channels filled in. */
const scalesOf = (partial: Partial<AestheticScales>): AestheticScales => ({
	...EMPTY_SCALES,
	...partial,
})

describe("resolveGeoFill", () => {
	it("returns the base fill unchanged when no measure is mapped", () => {
		const { fill, fillOpacity } = resolveGeoFill(
			"#base",
			{ cat: "A" },
			null,
			EMPTY_SCALES,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(fill).toBe("#base")
		expect(fillOpacity).toBeUndefined()
	})

	it("hue wins: fill comes from the hue scale, no fill-opacity", () => {
		const hue = hueOver(["A", "B", "C"])
		const { fill, fillOpacity } = resolveGeoFill(
			"#base",
			{ cat: "A" },
			hue!.field,
			scalesOf({ hue }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(fill).not.toBe("#base")
		expect(fillOpacity).toBeUndefined()
	})

	it("opacity-only: uses OPACITY_BASE_FILL + a numeric fill-opacity", () => {
		const opacity = opacityOver([0, 10])
		const { fill, fillOpacity } = resolveGeoFill(
			"#base",
			{ n: 10 },
			opacity!.field,
			scalesOf({ opacity }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(fill).toBe(OPACITY_BASE_FILL)
		expect(typeof fillOpacity).toBe("number")
	})

	it("hue takes precedence over opacity when both are mapped", () => {
		const hue = hueOver(["A", "B"])
		const opacity = opacityOver([0, 10])
		const { fill, fillOpacity } = resolveGeoFill(
			"#base",
			{ cat: "A", n: 10 },
			hue!.field,
			scalesOf({ hue, opacity }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(fill).not.toBe(OPACITY_BASE_FILL)
		expect(fillOpacity).toBeUndefined()
	})

	it("flags measureMissing when a mapped measure value is blank/NA", () => {
		const hue = hueOver(["A", "B"])
		// Blank cell → the hue scale can't resolve → base fill + missing flag.
		const missing = resolveGeoFill(
			"#base",
			{ cat: "" },
			hue!.field,
			scalesOf({ hue }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(missing.fill).toBe("#base")
		expect(missing.measureMissing).toBe(true)
		// A resolving value is NOT missing.
		const ok = resolveGeoFill(
			"#base",
			{ cat: "A" },
			hue!.field,
			scalesOf({ hue }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(ok.measureMissing).toBe(false)
		// No measure mapped at all is "no measure", not "missing data".
		const none = resolveGeoFill(
			"#base",
			{ cat: "" },
			null,
			EMPTY_SCALES,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(none.measureMissing).toBe(false)
	})

	it("brightness modulates the hue color, and keeps the palette key", () => {
		// Hue on `cat` + brightness on `b`: two rows of the SAME category must
		// draw DIFFERENT shades of that category's palette color, and both keep
		// the un-modulated color as the pattern-ink palette key.
		const hue = hueOver(["A", "B"])
		const brightness = unitOver([0, 100], "b")
		const scales = scalesOf({ hue, brightness })
		const dark = resolveGeoFill(
			"#base",
			{ cat: "A", b: 0 },
			hue!.field,
			scales,
			EMPTY_CHANNEL_CONFIGS
		)
		const light = resolveGeoFill(
			"#base",
			{ cat: "A", b: 100 },
			hue!.field,
			scales,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(dark.fill).not.toBe(light.fill)
		expect(dark.preModulationHue).toBe(light.preModulationHue)
		expect(dark.fill).not.toBe(dark.preModulationHue)
		expect(dark.briUnit).not.toBe(light.briUnit)
	})

	it("saturation modulates too, and an unmapped pair leaves the fill alone", () => {
		const hue = hueOver(["A", "B"])
		const saturation = unitOver([0, 100], "s")
		const plain = resolveGeoFill(
			"#base",
			{ cat: "A", s: 0 },
			hue!.field,
			scalesOf({ hue }),
			EMPTY_CHANNEL_CONFIGS
		)
		const muted = resolveGeoFill(
			"#base",
			{ cat: "A", s: 0 },
			hue!.field,
			scalesOf({ hue, saturation }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(plain.fill).toBe(plain.preModulationHue)
		expect(plain.satUnit).toBeNull()
		expect(muted.fill).not.toBe(muted.preModulationHue)
	})

	it("modulates the opacity-only base fill as well", () => {
		const opacity = opacityOver([0, 10])
		const brightness = unitOver([0, 100], "b")
		const r = resolveGeoFill(
			"#base",
			{ n: 10, b: 100 },
			opacity!.field,
			scalesOf({ opacity, brightness }),
			EMPTY_CHANNEL_CONFIGS
		)
		expect(r.preModulationHue).toBe(OPACITY_BASE_FILL)
		expect(r.fill).not.toBe(OPACITY_BASE_FILL)
		expect(typeof r.fillOpacity).toBe("number")
	})
})

describe("resolveNoDataPatternDef", () => {
	it("returns null when no pattern is configured", () => {
		expect(
			resolveNoDataPatternDef({
				noDataPattern: null,
				noDataFill: "#e7e5e4",
				noDataPatternInk: "#a8a29e",
			})
		).toBeNull()
	})

	it("bakes the no-data fill + ink into a fixed-id def", () => {
		const def = resolveNoDataPatternDef({
			noDataPattern: 2,
			noDataFill: "#e7e5e4",
			noDataPatternInk: "#a8a29e",
		})
		expect(def).toEqual({
			svgId: "vc-pat-nodata",
			paletteIdx: 2,
			bgColor: "#e7e5e4",
			inkColor: "#a8a29e",
		})
	})
})

describe("resolveGeoOutlineColor", () => {
	const outlineOver = (values: string[]): AestheticScales["outlineHue"] => ({
		scale: makeHueScale(values, "categorical"),
		field: { name: "grp", type: "categorical" },
	})

	it("returns the base color when no outlineHue is mapped", () => {
		expect(
			resolveGeoOutlineColor("#base", { grp: "A" }, null, undefined)
		).toBe("#base")
	})

	it("uses the outlineHue scale color when mapped and no rule matches", () => {
		const outline = outlineOver(["A", "B"])
		const stroke = resolveGeoOutlineColor(
			"#base",
			{ grp: "A" },
			outline,
			undefined
		)
		expect(stroke).not.toBe("#base")
	})

	it("a matching conditional rule wins over the scale color", () => {
		const outline = outlineOver(["A", "B"])
		const stroke = resolveGeoOutlineColor("#base", { grp: "A" }, outline, [
			{ condition: '=="A"', color: "#rule" },
		])
		expect(stroke).toBe("#rule")
	})
})

// ----- Pattern channel on geo marks ------------------------------------------

/** Scales with a categorical pattern field `p` over A/B (and optionally hue). */
const patternScales = (withHue: boolean): AestheticScales => ({
	...EMPTY_SCALES,
	hue: withHue ? hueOver(["A", "B", "C"]) : null,
	pattern: {
		field: { name: "p", type: "categorical" },
		categories: ["A", "B"],
	},
})

describe("resolveGeoPatternDef / geoPatternFill", () => {
	it("returns null (plain fill) when no pattern field is mapped", () => {
		expect(
			resolveGeoPatternDef({ p: "A" }, "#123456", EMPTY_SCALES, EMPTY_CHANNEL_CONFIGS)
		).toBeNull()
		expect(
			geoPatternFill({ p: "A" }, "#123456", EMPTY_SCALES, EMPTY_CHANNEL_CONFIGS)
		).toBe("#123456")
	})

	it("returns null for a row with no / unknown pattern value", () => {
		const scales = patternScales(true)
		expect(
			resolveGeoPatternDef({}, "#123456", scales, EMPTY_CHANNEL_CONFIGS)
		).toBeNull()
		expect(
			resolveGeoPatternDef({ p: "Z" }, "#123456", scales, EMPTY_CHANNEL_CONFIGS)
		).toBeNull()
	})

	it("with hue mapped, the mark's resolved fill is the pattern background", () => {
		const scales = patternScales(true)
		const def = resolveGeoPatternDef(
			{ p: "A" },
			"#123456",
			scales,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(def).not.toBeNull()
		expect(def!.bgColor).toBe("#123456")
		expect(
			geoPatternFill({ p: "A" }, "#123456", scales, EMPTY_CHANNEL_CONFIGS)
		).toBe(`url(#${def!.svgId})`)
	})

	it("without hue, the shared pattern background fallback is used", () => {
		const scales = patternScales(false)
		const def = resolveGeoPatternDef(
			{ p: "A" },
			"#123456",
			scales,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(def).not.toBeNull()
		// The cartesian renderers' shared default tile background.
		expect(def!.bgColor).toBe("#e2e8f0")
	})

	it("cycles the pattern palette by category index", () => {
		const scales = patternScales(true)
		const a = resolveGeoPatternDef({ p: "A" }, "#111111", scales, EMPTY_CHANNEL_CONFIGS)
		const b = resolveGeoPatternDef({ p: "B" }, "#111111", scales, EMPTY_CHANNEL_CONFIGS)
		expect(a!.paletteIdx).toBe(0)
		expect(b!.paletteIdx).toBe(1)
		expect(a!.svgId).not.toBe(b!.svgId)
	})
})

describe("buildGeoPatternDefs", () => {
	it("returns [] when no pattern field is mapped", () => {
		expect(
			buildGeoPatternDefs(
				[{ row: { p: "A" }, fill: "#111111" }],
				EMPTY_SCALES,
				EMPTY_CHANNEL_CONFIGS
			)
		).toEqual([])
	})

	it("dedups marks sharing a category + fill into one def", () => {
		const scales = patternScales(true)
		const defs = buildGeoPatternDefs(
			[
				{ row: { p: "A" }, fill: "#111111" },
				{ row: { p: "A" }, fill: "#111111" },
				{ row: { p: "B" }, fill: "#222222" },
			],
			scales,
			EMPTY_CHANNEL_CONFIGS
		)
		expect(defs).toHaveLength(2)
		expect(new Set(defs.map((d) => d.svgId)).size).toBe(2)
	})
})

describe("buildRegionStyleResolvers with a pattern field", () => {
	const feature = (id: string): Feature => ({
		type: "Feature",
		id,
		properties: {},
		geometry: { type: "Point", coordinates: [0, 0] },
	})

	it("matched regions fill with a pattern ref; unmatched keep the no-data fill", () => {
		const scales = patternScales(true)
		const resolvers = buildRegionStyleResolvers({
			featureToRow: new Map([["06", { cat: "A", p: "A" }]]),
			noDataFill: "#nodata",
			measureField: scales.hue!.field,
			baseOutlineColor: "#base",
			outlineHue: null,
			outlineColorRules: undefined,
			aestheticScales: scales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(resolvers.fillFor(feature("06"))).toMatch(/^url\(#vc-pat-/)
		expect(resolvers.fillFor(feature("48"))).toBe("#nodata")
	})

	it("no-data pattern: unmatched AND blank-measure regions take the pattern ref", () => {
		const scales = patternScales(true)
		const noDataDef = resolveNoDataPatternDef({
			noDataPattern: 1,
			noDataFill: "#nodata",
			noDataPatternInk: "#ink",
		})
		const resolvers = buildRegionStyleResolvers({
			featureToRow: new Map([
				["06", { cat: "A" }], // resolves via the hue scale
				["48", { cat: "" }], // blank measure cell → missing data
			]),
			noDataFill: "#nodata",
			noDataPatternDef: noDataDef,
			measureField: scales.hue!.field,
			baseOutlineColor: "#base",
			outlineHue: null,
			outlineColorRules: undefined,
			// Hue only — no pattern channel on this map.
			aestheticScales: scalesOf({ hue: scales.hue }),
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		// A resolving measure keeps its scale color (no pattern channel here).
		expect(resolvers.fillFor(feature("06"))).not.toBe("url(#vc-pat-nodata)")
		// Blank measure and absent-from-dataset look identical: the pattern ref.
		expect(resolvers.fillFor(feature("48"))).toBe("url(#vc-pat-nodata)")
		expect(resolvers.fillFor(feature("31"))).toBe("url(#vc-pat-nodata)")
	})

	it("no-data pattern: a row's own pattern-channel category wins over it", () => {
		// Pattern field + a hue measure whose value is blank on this row.
		const scales = scalesOf({
			...patternScales(false),
			hue: hueOver(["A"]),
		})
		const noDataDef = resolveNoDataPatternDef({
			noDataPattern: 1,
			noDataFill: "#nodata",
			noDataPatternInk: "#ink",
		})
		const resolvers = buildRegionStyleResolvers({
			featureToRow: new Map([["06", { cat: "", p: "A" }]]),
			noDataFill: "#nodata",
			noDataPatternDef: noDataDef,
			measureField: scales.hue!.field, // measure mapped, value blank
			baseOutlineColor: "#base",
			outlineHue: null,
			outlineColorRules: undefined,
			aestheticScales: scales,
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		const fill = resolvers.fillFor(feature("06"))
		expect(fill).toMatch(/^url\(#vc-pat-/)
		expect(fill).not.toBe("url(#vc-pat-nodata)")
	})
})

describe("buildRegionStyleResolvers with brightness mapped", () => {
	const feature = (id: string): Feature => ({
		type: "Feature",
		id,
		properties: {},
		geometry: { type: "Point", coordinates: [0, 0] },
	})

	it("two regions of one hue category shade apart by brightness", () => {
		// The faceted-choropleth case: hue gives each category its color,
		// brightness varies WITHIN it. Both regions share `cat: "A"`, so only
		// modulation can tell their fills apart.
		const hue = hueOver(["A", "B"])
		const resolvers = buildRegionStyleResolvers({
			featureToRow: new Map([
				["06", { cat: "A", b: 0 }],
				["48", { cat: "A", b: 100 }],
			]),
			noDataFill: "#nodata",
			measureField: hue!.field,
			baseOutlineColor: "#base",
			outlineHue: null,
			outlineColorRules: undefined,
			aestheticScales: scalesOf({
				hue,
				brightness: unitOver([0, 100], "b"),
			}),
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(resolvers.fillFor(feature("06"))).not.toBe(
			resolvers.fillFor(feature("48"))
		)
		// Neither is the no-data paint, and neither region reads as no-data.
		expect(resolvers.fillFor(feature("06"))).not.toBe("#nodata")
		expect(resolvers.noDataFor(feature("06"))).toBe(false)
		expect(resolvers.noDataFor(feature("48"))).toBe(false)
	})

	it("unmatched regions stay on the un-modulated no-data fill", () => {
		const hue = hueOver(["A", "B"])
		const resolvers = buildRegionStyleResolvers({
			featureToRow: new Map([["06", { cat: "A", b: 100 }]]),
			noDataFill: "#nodata",
			measureField: hue!.field,
			baseOutlineColor: "#base",
			outlineHue: null,
			outlineColorRules: undefined,
			aestheticScales: scalesOf({
				hue,
				brightness: unitOver([0, 100], "b"),
			}),
			channelConfigs: EMPTY_CHANNEL_CONFIGS,
		})
		expect(resolvers.fillFor(feature("31"))).toBe("#nodata")
	})
})
