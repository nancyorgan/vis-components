import { describe, expect, it } from "vitest"

import { SWEEP_CHARTS, withSweepDefaults, type SweepChart } from "../../../testSupport/sweepCharts"
import { SWEEP_DATASETS } from "../../../testSupport/sweepDatasets"

import { composeVisual } from "./chartSpec"
import {
	colorSections,
	drawnParts,
	isPureDensityCurve,
	modulationSections,
	offeredTargets,
	opacitySections,
	PART_EXCEPTIONS,
	partIdsOffered,
	partPaletteKind,
	partsContext,
	partsOffered,
	sizedMarkTitle,
	sizeSections,
	type PartMenu,
	type PartsContext,
} from "./markParts"
import { patternMenu } from "./patternMenu"
import { LIGHT_THEME_BASE } from "./systemThemes"
import { explainChannelCustomization } from "./themeConfig"

/** The parts context for one of the sweep charts — the same charts the
 *  options matrix snapshot and the browser sweep use. */
const contextFor = (chart: SweepChart): PartsContext => {
	const dataset = SWEEP_DATASETS[chart.dataset]
	const { visual, problems } = composeVisual(
		{
			datasetId: dataset.id,
			folderId: null,
			name: chart.label,
			variation: chart.variation,
			encodings: chart.encodings,
			settings: withSweepDefaults(chart).settings,
		},
		{
			fields: dataset.fields.map((f) => ({ name: f.name, type: f.inferredType })),
			theme: LIGHT_THEME_BASE,
			latestVersionId: "v1",
			rows: dataset.rows,
			now: 1000,
		}
	)
	expect(problems, `${chart.id} should compose`).toEqual([])
	return partsContext({
		encodings: visual.encodings,
		configs: visual.channelConfigs,
		mapConfig: visual.mapConfig,
		getType: (name) => dataset.fields.find((f) => f.name === name)?.inferredType,
	})
}

const chart = (id: string): SweepChart => {
	const found = SWEEP_CHARTS.find((c) => c.id === id)
	if (!found) throw new Error(`no sweep chart "${id}"`)
	return found
}

describe("mark parts — section order", () => {
	it("a line chart lists its Line, then the points' fill and outline, in every menu", () => {
		const expected = ["Line", "Point fill", "Point outline"]
		expect(partsOffered(contextFor(chart("line")))).toEqual({
			color: expected,
			opacity: expected,
			saturation: expected,
			brightness: expected,
		})
	})

	it("an area chart leads with its Line, then Area fill, Point fill, Point outline", () => {
		const expected = ["Line", "Area fill", "Point fill", "Point outline"]
		expect(partsOffered(contextFor(chart("area-stacked")))).toEqual({
			color: expected,
			opacity: expected,
			saturation: expected,
			brightness: expected,
		})
	})

	it("a filled radar names its four parts the same in every menu", () => {
		const expected = ["Line", "Polygon fill", "Point fill", "Point outline"]
		expect(partsOffered(contextFor(chart("radar-filled")))).toEqual({
			color: expected,
			opacity: expected,
			saturation: expected,
			brightness: expected,
		})
	})

	it("the area's Line is the linked editor in Color and a per-part target elsewhere", () => {
		const ctx = contextFor(chart("area-stacked"))
		expect(colorSections(ctx)[0]).toEqual({ part: "line", kind: "areaLine", title: "Line" })
		expect(opacitySections(ctx)[0]).toMatchObject({ kind: "slot", def: { key: "border", label: "Line" } })
		expect(modulationSections(ctx)[0]).toMatchObject({ kind: "slot", def: { key: "line", label: "Line" } })
	})

	it("area charts drop the in-panel Vary by from Color's fill and from every Opacity part", () => {
		const ctx = contextFor(chart("area-stacked"))
		expect(colorSections(ctx).find((s) => s.kind === "fill")).toMatchObject({ hideVaryBy: true })
		expect(opacitySections(ctx).every((s) => s.hideVaryBy)).toBe(true)
		const line = contextFor(chart("line"))
		expect(colorSections(line).find((s) => s.kind === "fill")).toMatchObject({ hideVaryBy: false })
		expect(opacitySections(line).every((s) => !s.hideVaryBy)).toBe(true)
	})

	it("the radar's connection line is the Line target, inheriting as the polygon outline", () => {
		const line = colorSections(contextFor(chart("radar-polygon"))).find(
			(s) => s.kind === "slot" && s.radarLine
		)
		expect(line).toMatchObject({
			kind: "slot",
			part: "line",
			radarLine: true,
			def: { key: "line", label: "Line", inherit: { label: expect.any(String) } },
		})
	})

	it("flow diagrams' node fill is its own target in Opacity, beside the ribbons'", () => {
		const offered = partsOffered(contextFor(chart("sankey")))
		expect(offered.opacity).toEqual(["Node fill", "Node outline", "Ribbon fill"])
		expect(offered.color).toEqual(["Node fill", "Node outline"])
	})

	it("a dot map lists its regions apart from its points, in every menu", () => {
		// The points are the marks; the geography behind them is styled on its
		// own. Bodies first, then the points — the bubble map's order, where
		// the roles are the other way round.
		const dotMap = partsOffered(contextFor(chart("dot-map")))
		const parts = ["Region fill", "Region outline", "Point fill", "Point outline"]
		expect(dotMap.color).toEqual(parts)
		expect(dotMap.opacity).toEqual(parts)
		expect(dotMap.saturation).toEqual(parts)
		expect(dotMap.brightness).toEqual(parts)
		expect(partsOffered(contextFor(chart("bubble-map"))).color).toEqual(parts)
	})

	it("always names the mark: no menu on any chart shows a bare Fill or Outline", () => {
		for (const c of SWEEP_CHARTS) {
			const offered = partsOffered(contextFor(c))
			for (const [menu, titles] of Object.entries(offered)) {
				expect(titles, `${c.id} · ${menu}`).not.toContain("Fill")
				expect(titles, `${c.id} · ${menu}`).not.toContain("Outline")
			}
		}
	})

	it("lists the parts in one order in every menu", () => {
		// Whatever subset a menu offers, the parts it shares with another menu
		// come in the same order there.
		for (const c of SWEEP_CHARTS) {
			const offered = partsOffered(contextFor(c))
			const menus = Object.entries(offered)
			for (const [menuA, a] of menus)
				for (const [menuB, b] of menus) {
					const shared = a.filter((title) => b.includes(title))
					expect(
						b.filter((title) => shared.includes(title)),
						`${c.id} · ${menuA} vs ${menuB}`
					).toEqual(shared)
				}
		}
	})

	it("orders bodies first, then the line with what it encloses and carries, then overlays", () => {
		expect(partsOffered(contextFor(chart("combo-line"))).color).toEqual([
			"Bar fill",
			"Bar outline",
			"Line",
			"Point fill",
		])
		expect(partsOffered(contextFor(chart("bubble-map"))).color).toEqual([
			"Region fill",
			"Region outline",
			"Point fill",
			"Point outline",
		])
		expect(partsOffered(contextFor(chart("histogram"))).color).toEqual([
			"Bar fill",
			"Bar outline",
			"Density curve fill",
			"Density curve outline",
			"Rug",
		])
		expect(partsOffered(contextFor(chart("vector-field"))).color).toEqual(["Segment"])
	})

	it("no menu lists the same title twice", () => {
		for (const c of SWEEP_CHARTS) {
			const offered = partsOffered(contextFor(c))
			for (const [menu, titles] of Object.entries(offered))
				expect(new Set(titles).size, `${c.id} · ${menu}`).toBe(titles.length)
		}
	})
})

describe("mark parts — the pure density curve", () => {
	it("is detected for the standalone density display and hides the marks' own parts", () => {
		const ctx = contextFor(chart("density"))
		expect(ctx.pureDensityCurve).toBe(true)
		const offered = partsOffered(ctx)
		// No marks are drawn: every menu lists the curve and nothing else.
		expect(offered.color).toEqual(["Density curve outline"])
		expect(offered.opacity).toEqual(["Density curve outline"])
		expect(offered.saturation).toEqual(["Density curve outline"])
	})

	it("is not claimed for a histogram with a density overlay, whose bars still draw", () => {
		const ctx = contextFor(chart("histogram"))
		expect(ctx.pureDensityCurve).toBe(false)
		expect(partsOffered(ctx).color.slice(0, 2)).toEqual(["Bar fill", "Bar outline"])
	})

	it("needs a type lookup: without one the answer is no", () => {
		const ctx = contextFor(chart("density"))
		expect(isPureDensityCurve(ctx.modeDef, ctx.encodings, ctx.configs, undefined)).toBe(false)
	})
})

describe("mark parts — what the chart draws", () => {
	const drawn = (id: string) => drawnParts(contextFor(chart(id)))

	it("a scatter draws glyph points with an outline, and no line until Connection is mapped", () => {
		expect(drawn("scatter-plain")).toMatchObject({
			marks: true,
			points: true,
			glyphs: true,
			outline: true,
			line: false,
			stems: false,
		})
		expect(drawn("line")).toMatchObject({ points: true, glyphs: true, line: true })
	})

	it("bars, slices and cells draw outlined marks but no points", () => {
		for (const id of ["bars-grouped", "pie-single", "tile", "hexbin", "choropleth"])
			expect(drawn(id), id).toMatchObject({ marks: true, points: false, glyphs: false, outline: true })
	})

	it("an area chart draws its line and the points along it, which are glyphs like a line chart's", () => {
		expect(drawn("area-stacked")).toMatchObject({ line: true, points: true, glyphs: true })
	})

	it("a combo draws points whether or not a line joins them", () => {
		expect(drawn("combo-points")).toMatchObject({ points: true, glyphs: true, line: false })
		expect(drawn("combo-line")).toMatchObject({ points: true, glyphs: true, line: true })
	})

	it("line segments are neither points nor outlined", () => {
		expect(drawn("vector-field")).toMatchObject({
			marks: true,
			segments: true,
			points: false,
			glyphs: false,
			outline: false,
		})
	})

	it("the pure density curve draws no marks at all", () => {
		expect(drawn("density")).toMatchObject({
			marks: false,
			points: false,
			glyphs: false,
			segments: false,
			outline: false,
			stems: false,
		})
	})

	it("stems are drawn once switched on, with or without a line", () => {
		expect(drawn("stems")).toMatchObject({ stems: true, line: false })
		expect(drawn("scatter-plain").stems).toBe(false)
	})

	it("\"Show points: No points\" leaves a line chart with its line and no points", () => {
		const ctx = contextFor(chart("line"))
		const hidden = drawnParts({
			...ctx,
			configs: {
				...ctx.configs,
				connection: { ...ctx.configs.connection, pointSampling: "none" },
			} as PartsContext["configs"],
		})
		expect(hidden).toMatchObject({ line: true, points: false, glyphs: false })
	})

	it("the rug counts only while it is switched on beside a histogram or density curve", () => {
		// The histogram fixture has its rug on; the density one has none.
		const ctx = contextFor(chart("histogram"))
		expect(drawnParts(ctx).rug).toBe(true)
		expect(partsOffered(ctx).color).toContain("Rug")
		expect(partsOffered(ctx).opacity).toContain("Rug")
		const x = ctx.configs.x
		const withoutRug = {
			...ctx,
			configs: {
				...ctx.configs,
				x: { ...x, histogram: { ...x?.histogram, showRug: false } },
			} as PartsContext["configs"],
		}
		expect(drawnParts(withoutRug).rug).toBe(false)
		expect(partsOffered(withoutRug).color).not.toContain("Rug")
		expect(partsOffered(withoutRug).opacity).not.toContain("Rug")
		expect(drawn("density").rug).toBe(false)
	})
})

describe("mark parts — the edited dots count only what the chart shows", () => {
	/** A chart's `configs` with per-part targets a LINE chart would have
	 *  stored: a recolored Line, a half-transparent Line, a desaturated Line. */
	const withLineTargets = (ctx: PartsContext): PartsContext => ({
		...ctx,
		configs: {
			...ctx.configs,
			colorSlots: { ...ctx.configs.colorSlots, line: { field: null, singleColor: "#123456" } },
			opacitySlots: { ...ctx.configs.opacitySlots, line: { field: null, level: 0.5 } },
			saturationSlots: { ...ctx.configs.saturationSlots, outline: { field: null, level: 0.2 } },
		},
	})
	/** Whether the menu's per-part targets are among what lights its dot.
	 *  (The dot has other causes too — a palette pick, an outline color —
	 *  which these charts may well have; only the targets are in question.) */
	const SLOT_CAUSE: Record<string, string> = {
		hue: "color slots",
		opacity: "opacity slots",
		saturation: "saturation slots",
	}
	const dotted = (channel: string, ctx: PartsContext, respectChart: boolean): boolean =>
		explainChannelCustomization(
			channel,
			ctx.configs,
			LIGHT_THEME_BASE,
			false,
			ctx.encodings.hue?.field ?? null,
			respectChart ? offeredTargets(ctx) : undefined
		).includes(SLOT_CAUSE[channel] ?? "")

	it("on the chart that shows those parts, they light the dots", () => {
		const ctx = withLineTargets(contextFor(chart("line-temporal")))
		expect(dotted("hue", ctx, true)).toBe(true)
		expect(dotted("opacity", ctx, true)).toBe(true)
		expect(dotted("saturation", ctx, true)).toBe(true)
	})

	it("left behind on a bar chart, which shows none of them, they do not", () => {
		// Bars have no Line: no control here can clear a Line's color or
		// opacity, so a dot would be unclearable.
		const ctx = withLineTargets(contextFor(chart("bars-grouped")))
		expect(offeredTargets(ctx).color.has("line")).toBe(false)
		expect(dotted("hue", ctx, true)).toBe(false)
		expect(dotted("opacity", ctx, true)).toBe(false)
		// The Outline's saturation IS a part of a bar (its Bar outline), so
		// that one counts — and the Bar outline section can clear it.
		expect(offeredTargets(ctx).modulation.has("outline")).toBe(true)
		expect(dotted("saturation", ctx, true)).toBe(true)
	})

	it("an area chart's Line is a different target in Color and Opacity, so the line chart's do not count there", () => {
		const ctx = withLineTargets(contextFor(chart("area-stacked")))
		expect(dotted("hue", ctx, true)).toBe(false)
		expect(dotted("opacity", ctx, true)).toBe(false)
	})

	it("a line thickness left on a chart that draws no line does not light Size, nor its cap Connection", () => {
		const thick = (id: string): PartsContext => {
			const ctx = contextFor(chart(id))
			return {
				...ctx,
				configs: {
					...ctx.configs,
					connection: { ...ctx.configs.connection, thickness: 9, lineCap: "square" },
				} as PartsContext["configs"],
			}
		}
		// (The fixtures' other settings are not this theme's, so only the
		// causes under test are read.)
		const causes = (
			channel: "connection" | "area",
			ctx: PartsContext,
			respectChart: boolean
		): string[] =>
			explainChannelCustomization(
				channel,
				ctx.configs,
				LIGHT_THEME_BASE,
				!!ctx.encodings[channel]?.field,
				null,
				respectChart ? offeredTargets(ctx) : undefined
			).filter((cause) => ["line thickness", "line cap", "axis stem"].includes(cause))
		// The cap is Connection's; the thickness is Size's, with every other.
		expect(causes("connection", thick("line"), true)).toEqual(["line cap"])
		expect(causes("area", thick("line"), true)).toEqual(["line thickness"])
		expect(causes("connection", thick("scatter-plain"), true)).toEqual([])
		expect(causes("area", thick("scatter-plain"), true)).toEqual([])
		// Stems with no line: neither the line's thickness nor its cap has a
		// control there (the stems have a thickness of their own).
		expect(causes("connection", thick("stems"), true)).toEqual(["axis stem"])
		expect(causes("area", thick("stems"), true)).toEqual([])
		// Not knowing the chart, every stored setting counts.
		expect(causes("connection", thick("scatter-plain"), false)).toEqual(["line cap"])
		expect(causes("area", thick("scatter-plain"), false)).toEqual(["line thickness"])
	})

	it("each thickness lights Size only while the chart draws its stroke", () => {
		const withConfigs = (id: string, patch: Record<string, unknown>): PartsContext => {
			const ctx = contextFor(chart(id))
			return { ...ctx, configs: { ...ctx.configs, ...patch } as PartsContext["configs"] }
		}
		const sizeCauses = (ctx: PartsContext): string[] =>
			explainChannelCustomization(
				"area",
				ctx.configs,
				LIGHT_THEME_BASE,
				!!ctx.encodings.area?.field,
				null,
				offeredTargets(ctx)
			)
		// The outline: on the Size row, and no longer on Shape (the glyphs).
		const theme = { shape: { outlineWidth: LIGHT_THEME_BASE.outlineWidth } }
		const thick = { shape: { outlineWidth: LIGHT_THEME_BASE.outlineWidth + 5 } }
		expect(sizeCauses(withConfigs("bars-grouped", theme))).not.toContain("outline thickness")
		expect(sizeCauses(withConfigs("bars-grouped", thick))).toContain("outline thickness")
		const shapeCauses = (ctx: PartsContext): string[] =>
			explainChannelCustomization("shape", ctx.configs, LIGHT_THEME_BASE, false)
		expect(shapeCauses(withConfigs("bars-grouped", thick))).toEqual(
			shapeCauses(withConfigs("bars-grouped", theme))
		)
		// Segments draw no outline, so an outline thickness does not count there.
		expect(sizeCauses(withConfigs("vector-field", thick))).not.toContain("outline thickness")
		// The stems' own thickness: only while stems are drawn.
		const stem = { connection: { axisStem: "x-axis", stemThickness: 7 } }
		expect(sizeCauses(withConfigs("stems", stem))).toContain("stem thickness")
		expect(
			sizeCauses(withConfigs("scatter-plain", { connection: { stemThickness: 7 } }))
		).not.toContain("stem thickness")
		// The density curve's: only while a curve is drawn.
		const curve = { shape: { outlineWidth: LIGHT_THEME_BASE.outlineWidth, densityCurveOutlineWidth: 5 } }
		expect(sizeCauses(withConfigs("density", curve))).toContain("density curve thickness")
		expect(sizeCauses(withConfigs("scatter-plain", curve))).not.toContain("density curve thickness")
		// Segment thickness: only where segments are drawn.
		const segment = { length: { minLength: 4, maxLength: 40, segmentThickness: 9 } }
		expect(sizeCauses(withConfigs("vector-field", segment))).toContain("segment thickness")
		expect(sizeCauses(withConfigs("scatter-plain", segment))).not.toContain("segment thickness")
	})

	it("a caller that does not say which chart still counts every stored target", () => {
		const ctx = withLineTargets(contextFor(chart("bars-grouped")))
		expect(dotted("hue", ctx, false)).toBe(true)
		expect(dotted("opacity", ctx, false)).toBe(true)
		expect(dotted("saturation", ctx, false)).toBe(true)
	})
})

/** Parts a menu does not list although another menu lists them for the same
 *  chart, per chart — leaving out the written exceptions (`PART_EXCEPTIONS`). */
const disagreements = (): Record<string, Record<string, string[]>> => {
	const excepted = (menu: PartMenu, part: string): boolean =>
		PART_EXCEPTIONS.some((e) => e.part === part && e.menus.includes(menu))
	const out: Record<string, Record<string, string[]>> = {}
	for (const c of SWEEP_CHARTS) {
		const offered = partIdsOffered(contextFor(c))
		const everywhere = new Set(Object.values(offered).flat())
		const missing: Record<string, string[]> = {}
		for (const [menu, parts] of Object.entries(offered) as Array<[PartMenu, string[]]>) {
			const absent = [...everywhere].filter(
				(part) => !parts.includes(part) && !excepted(menu, part)
			)
			if (absent.length > 0) missing[`not in ${menu}`] = absent
		}
		if (Object.keys(missing).length > 0) out[c.id] = missing
	}
	return out
}

describe("mark parts — a part's palette follows its kind", () => {
	it("bodies under a line or points take the fill palette; everything else Color's", () => {
		for (const body of ["body", "violinFill", "densityFill", "regressionBand"] as const)
			expect(partPaletteKind(body)).toBe("fill")
		for (const other of [
			"line",
			"pointFill",
			"pointOutline",
			"markFill",
			"markOutline",
			"stem",
			"regressionLine",
			"violinOutline",
			"densityOutline",
			"rug",
		] as const)
			expect(partPaletteKind(other)).toBe("categorical")
	})

	it("so a radar's polygon and a confidence band lead with the fill palette, like a violin", () => {
		const kindOf = (id: string, title: string): string | undefined => {
			const section = colorSections(contextFor(chart(id))).find(
				(s) => (s.kind === "slot" ? s.def.label : s.title) === title
			)
			return section && partPaletteKind(section.part)
		}
		expect(kindOf("radar-filled", "Polygon fill")).toBe("fill")
		expect(kindOf("scatter-regression", "Confidence interval")).toBe("fill")
		expect(kindOf("violin", "Violin / box fill")).toBe("fill")
		expect(kindOf("violin", "Violin / box outline")).toBe("categorical")
		expect(kindOf("line", "Line")).toBe("categorical")
	})
})

describe("mark parts — the Size menu's thickness sections", () => {
	const titles = (id: string): string[] => sizeSections(contextFor(chart(id))).map((s) => s.title)

	it("lists one section per stroke the chart draws, in the menus' one order", () => {
		expect(titles("scatter-plain")).toEqual(["Point outline"])
		expect(titles("line")).toEqual(["Line", "Point outline"])
		expect(titles("bars-grouped")).toEqual(["Bar outline"])
		expect(titles("pie-x")).toEqual(["Slice outline"])
		expect(titles("tile")).toEqual(["Cell outline"])
		expect(titles("area-stacked")).toEqual(["Line", "Point outline"])
		expect(titles("stems")).toEqual(["Point outline", "Stem"])
		// Segments are one stroke: no outline of their own.
		expect(titles("vector-field")).toEqual(["Segment"])
		expect(titles("scatter-regression")).toEqual(["Point outline", "Regression line"])
		// A dot map: its regions' outline and its points' are two thicknesses.
		expect(titles("dot-map")).toEqual(["Region outline", "Point outline"])
		// A density curve's line; the pure curve draws no marks to outline.
		expect(titles("density")).toEqual(["Density curve outline"])
		expect(titles("histogram")).toContain("Density curve outline")
	})

	it("titles each stroke exactly as Color and Opacity do", () => {
		for (const sweepChart of SWEEP_CHARTS) {
			const ctx = contextFor(sweepChart)
			const elsewhere = new Set([...partsOffered(ctx).color, ...partsOffered(ctx).opacity])
			for (const section of sizeSections(ctx))
				// A segment's stroke is the mark itself ("Segment").
				expect(elsewhere, `${sweepChart.id}: ${section.title}`).toContain(section.title)
		}
	})

	it("offers Vary by where strokes can differ: outlines, grouped lines and segments", () => {
		const varies = (id: string, kind: string): boolean | undefined =>
			sizeSections(contextFor(chart(id))).find((s) => s.kind === kind)?.varyBy
		expect(varies("line", "line")).toBe(true)
		expect(varies("radar-polygon", "line")).toBe(true)
		// An area chart's layers are grouped by Color and take one thickness.
		expect(varies("area-stacked", "line")).toBe(false)
		expect(varies("vector-field", "segment")).toBe(true)
		// Every mark's own outline can: each mark takes its level's thickness.
		expect(varies("bars-grouped", "outline")).toBe(true)
		expect(varies("scatter-plain", "outline")).toBe(true)
		// The overlays' strokes take one thickness.
		expect(varies("scatter-regression", "regressionLine")).toBe(false)
		expect(varies("stems", "stem")).toBe(false)
	})

	it("names what the Size encoding sizes", () => {
		expect(sizedMarkTitle(contextFor(chart("scatter-plain")).modeDef)).toBe("Point")
		expect(sizedMarkTitle(contextFor(chart("bubble-map")).modeDef)).toBe("Point")
		expect(sizedMarkTitle(contextFor(chart("packed-circles")).modeDef)).toBe("Circle")
	})
})

describe("mark parts — every menu lists the same parts", () => {
	/** The rule: a part that appears in one menu appears in all of them. A
	 *  part that can be colored can be made transparent, saturated and
	 *  brightened, and the other way round. This began as a snapshot of 26
	 *  chart types where the menus disagreed and was worked down to none;
	 *  it is now a plain assertion, so a new part cannot be added to one
	 *  menu alone. A part that genuinely cannot take an option is written
	 *  into `PART_EXCEPTIONS` with its reason. */
	it("on every chart type", () => {
		expect(disagreements()).toEqual({})
	})

	it("each exception names a reason, and is still needed", () => {
		for (const exception of PART_EXCEPTIONS) {
			expect(exception.reason.length, exception.part).toBeGreaterThan(40)
			// Some chart offers the part in a menu the exception does not cover…
			const offeredSomewhere = SWEEP_CHARTS.some((c) =>
				Object.values(partIdsOffered(contextFor(c))).some((parts) =>
					parts.includes(exception.part)
				)
			)
			expect(offeredSomewhere, `${exception.part} is offered nowhere`).toBe(true)
			// …and none offers it in a menu the exception says it is left out of.
			for (const c of SWEEP_CHARTS) {
				const offered = partIdsOffered(contextFor(c))
				for (const menu of exception.menus)
					expect(offered[menu], `${c.id} · ${menu}`).not.toContain(exception.part)
			}
		}
	})
})

describe("mark parts — stems are styled wherever they are drawn", () => {
	const withStems = (ctx: PartsContext): PartsContext => ({
		...ctx,
		configs: { ...ctx.configs, connection: { ...ctx.configs.connection, axisStem: "x-axis" } as never },
	})
	const menusListing = (ctx: PartsContext): string[] =>
		Object.entries(partIdsOffered(ctx))
			.filter(([, parts]) => parts.includes("stem"))
			.map(([menu]) => menu)
	const ALL_FOUR = ["color", "opacity", "saturation", "brightness"]
	const sizeListsStem = (ctx: PartsContext): boolean =>
		sizeSections(ctx).some((s) => s.kind === "stem")

	it("a scatter, a line chart and a bar + line combo list the Stem in all four menus", () => {
		for (const id of ["scatter-plain", "line", "combo-line", "combo-points", "combo-horizontal"]) {
			const ctx = withStems(contextFor(chart(id)))
			expect(menusListing(ctx), id).toEqual(ALL_FOUR)
			expect(sizeListsStem(ctx), id).toBe(true)
		}
	})

	it("no menu lists it while stems are switched off", () => {
		for (const id of ["scatter-plain", "combo-line"]) {
			expect(menusListing(contextFor(chart(id))), id).toEqual([])
			expect(sizeListsStem(contextFor(chart(id))), id).toBe(false)
		}
	})

	it("a chart that cannot draw stems lists none, whatever a leftover switch says", () => {
		// Bars and areas have no points to run a stem from; a pure density
		// curve draws no marks at all.
		for (const id of ["bars-grouped", "area-stacked", "radar-polygon", "density"]) {
			const ctx = withStems(contextFor(chart(id)))
			expect(menusListing(ctx), id).toEqual([])
			expect(sizeListsStem(ctx), id).toBe(false)
		}
	})

	it("the four menus and Size agree about the Stem on every chart", () => {
		for (const c of SWEEP_CHARTS) {
			const ctx = withStems(contextFor(c))
			expect(menusListing(ctx), c.id).toEqual(sizeListsStem(ctx) ? ALL_FOUR : [])
		}
	})
})

describe("mark parts — the Pattern menu", () => {
	/** The menu for a sweep chart: how it reads Pattern, and each section as
	 *  "Title" (under a header) or "(Title)" (listed bare). */
	const menu = (id: string, patternMapped = false, tweak?: (ctx: PartsContext) => PartsContext) => {
		const base = contextFor(chart(id))
		const { mode, sections } = patternMenu(tweak ? tweak(base) : base, patternMapped)
		return { mode, sections: sections.map((s) => (s.titled ? s.title : `(${s.title})`)) }
	}
	const withConfigs =
		(patch: (configs: PartsContext["configs"]) => PartsContext["configs"]) =>
		(ctx: PartsContext): PartsContext => ({ ...ctx, configs: patch(ctx.configs) })
	const noPoints = withConfigs((c) => ({
		...c,
		connection: { ...c.connection, pointSampling: "none" } as never,
	}))

	it("marks with no line: Pattern is their fill, listed bare", () => {
		expect(menu("bars-grouped")).toEqual({ mode: "fill", sections: ["(Bar fill)"] })
		expect(menu("pie-single")).toEqual({ mode: "fill", sections: ["(Slice fill)"] })
		expect(menu("scatter-plain")).toEqual({ mode: "fill", sections: ["(Point fill)"] })
	})

	it("a map's and a tree's Connection is a key, not a line: fill only", () => {
		for (const id of ["choropleth", "bubble-map", "treemap", "sunburst", "sankey", "chord"])
			expect(menu(id).mode, id).toBe("fill")
	})

	it("a line chart: the Line's dash, then the points' fill", () => {
		expect(menu("line")).toEqual({ mode: "compound", sections: ["Line", "Point fill"] })
		expect(menu("line", true)).toEqual({ mode: "compound", sections: ["Line", "Point fill"] })
	})

	it("a combo: the Line's dash and the bars' fill", () => {
		expect(menu("combo-line")).toEqual({ mode: "compound", sections: ["Bar fill", "Line"] })
	})

	it("an area chart: the Line, the Area fill while it is filled, and the points on it", () => {
		expect(menu("area-stacked")).toEqual({
			mode: "compound",
			sections: ["Line", "Area fill", "Point fill"],
		})
		expect(menu("area-unfilled")).toEqual({ mode: "compound", sections: ["Line", "Point fill"] })
	})

	it("a radar: the Line, the Polygon fill once filled, the points and the ring around them", () => {
		expect(menu("radar-polygon")).toEqual({
			mode: "compound",
			sections: ["Line", "Point fill", "Point outline"],
		})
		expect(menu("radar-filled")).toEqual({
			mode: "compound",
			sections: ["Line", "Polygon fill", "Point fill", "Point outline"],
		})
	})

	it("with the points hidden only the dash and the bodies are left", () => {
		expect(menu("line", false, noPoints)).toEqual({ mode: "dashOnly", sections: ["Line"] })
		expect(menu("area-stacked", false, noPoints)).toEqual({
			mode: "dashOnly",
			sections: ["Line", "Area fill"],
		})
		expect(menu("radar-filled", false, noPoints)).toEqual({
			mode: "dashOnly",
			sections: ["Line", "Polygon fill"],
		})
		// One kind of control once a variable is mapped: a dash per category,
		// listed bare.
		expect(menu("line", true, noPoints)).toEqual({ mode: "dashOnly", sections: ["(Line)"] })
	})

	it("beside a violin / box, the points' own picks get a header too", () => {
		expect(menu("violin")).toEqual({
			mode: "fill",
			sections: ["Point fill", "Violin / box fill"],
		})
	})

	const withRegression = withConfigs((c) => ({
		...c,
		x: { ...c.x, regression: { ...c.x?.regression, enabled: true } } as never,
	}))
	const withBox = withConfigs((c) => ({
		...c,
		y: { ...c.y, distributionOverlay: { ...c.y?.distributionOverlay, showBoxPlot: true } } as never,
	}))

	it("the regression line's dash is listed where the other menus list the line: before the violin / box", () => {
		expect(menu("scatter-regression").sections).toContain("Regression line")
		expect(menu("violin", false, withRegression).sections).toEqual([
			"Point fill",
			"Regression line",
			"Violin / box fill",
		])
	})

	it("the violin / box is listed exactly when the chart draws one", () => {
		// A switch left on from when the chart was a scatter draws nothing on
		// a bar chart: no section, and the bars' picks stay bare.
		expect(menu("bars-grouped", false, withBox)).toEqual({
			mode: "fill",
			sections: ["(Bar fill)"],
		})
		expect(menu("line", false, withBox).sections).toContain("Violin / box fill")
	})

	it("lists the violin / box and the regression line on the charts Color lists them on", () => {
		const titled = (sections: Array<{ kind: string; def?: { label: string }; title?: string }>) =>
			sections.map((s) => (s.kind === "slot" ? s.def?.label : s.title))
		for (const c of SWEEP_CHARTS)
			for (const tweak of [(ctx: PartsContext) => ctx, withBox, withRegression]) {
				const ctx = tweak(contextFor(c))
				const color = titled(colorSections(ctx))
				const pattern = patternMenu(ctx, false).sections.map((s) => s.title)
				for (const title of ["Violin / box fill", "Regression line"])
					expect(pattern.includes(title), `${c.id}: ${title}`).toBe(color.includes(title))
			}
	})

	it("thin line segments: Pattern is their dash", () => {
		const thin = withConfigs((c) => ({
			...c,
			pattern: { ...c.pattern, segmentPattern: "dash" } as never,
		}))
		expect(menu("vector-field", false, thin)).toEqual({
			mode: "segmentDash",
			sections: ["(Segment)"],
		})
		// A violin / box on such a chart is listed with or without a Pattern
		// variable.
		for (const mapped of [false, true])
			expect(menu("vector-field", mapped, (ctx) => withBox(thin(ctx))), String(mapped)).toEqual({
				mode: "segmentDash",
				sections: ["(Segment)", "Violin / box fill"],
			})
		expect(patternMenu(thin(contextFor(chart("vector-field"))), false).segments?.mode).toBe("dash")
		// With a line drawn the line owns the dash, and segments are not asked.
		expect(patternMenu(contextFor(chart("line")), false).segments).toBeNull()
	})
})
