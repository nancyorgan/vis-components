import { describe, expect, it } from "vitest"

import type {
	ChannelConfigs,
	ColorSlotKey,
	ModulationSlotKey,
	OpacitySlotKey,
} from "./channelConfig"
import { MODE_REGISTRY } from "./chartModes"
import { COLOR_SLOT_REGISTRY } from "./colorSlots"
import { MODULATION_SLOT_REGISTRY } from "./modulationSlots"
import { OPACITY_SLOT_REGISTRY } from "./opacitySlots"
import { menuTargets, PART_TARGETS, type TargetMenu } from "./partTargets"
import type { Encodings } from "./types"

/** The per-part targets are ONE table; Color, Opacity and Saturation /
 *  Brightness are views of it. These tests pin the two things the table
 *  must get right: every stored key is listed, and each target is offered
 *  on exactly the charts that draw its part — asked of the modes' declared
 *  traits, with the answers written out here by chart type so a change to a
 *  trait (or a new chart type) shows up as a line in this file. */

// Every key each menu can store. The `Record` type makes a key added to a
// storage type a compile error here until it is listed.
const COLOR_KEYS: Record<ColorSlotKey, true> = {
	line: true,
	rug: true,
	violinStroke: true,
	violinFill: true,
	densityCurveFill: true,
	densityCurveStroke: true,
	stem: true,
	geoPointFill: true,
	geoPointStroke: true,
	geoRegionFill: true,
	geoRegionStroke: true,
	regressionStroke: true,
	regressionCiFill: true,
	comboPointFill: true,
	polygonFill: true,
	areaPointFill: true,
}
const OPACITY_KEYS: Record<OpacitySlotKey, true> = {
	border: true,
	rug: true,
	line: true,
	violinStroke: true,
	violinFill: true,
	densityCurveFill: true,
	densityCurveStroke: true,
	stem: true,
	polygonFill: true,
	areaPointFill: true,
	areaPointOutline: true,
	node: true,
	ribbon: true,
	regressionStroke: true,
	regressionCiFill: true,
	geoPointFill: true,
	geoPointStroke: true,
	geoRegionFill: true,
	geoRegionStroke: true,
	comboPointFill: true,
}
const MODULATION_KEYS: Record<ModulationSlotKey, true> = {
	outline: true,
	line: true,
	violinFill: true,
	violinStroke: true,
	polygonFill: true,
	areaPointFill: true,
	areaPointOutline: true,
	geoPointFill: true,
	geoPointStroke: true,
	geoRegionFill: true,
	geoRegionStroke: true,
	comboPointFill: true,
	stem: true,
	regressionStroke: true,
	regressionCiFill: true,
	densityCurveFill: true,
	densityCurveStroke: true,
	rug: true,
}
const STORED: Record<TargetMenu, string[]> = {
	color: Object.keys(COLOR_KEYS),
	opacity: Object.keys(OPACITY_KEYS),
	modulation: Object.keys(MODULATION_KEYS),
}
const MENUS: readonly TargetMenu[] = ["color", "opacity", "modulation"]

describe("PART_TARGETS — every stored key, once", () => {
	it("lists each key once", () => {
		const keys = PART_TARGETS.map((t) => t.key)
		expect(new Set(keys).size).toBe(keys.length)
	})

	it.each(MENUS)("%s: the menu's view has exactly the keys it stores", (menu) => {
		expect(menuTargets(menu).map((t) => t.key).sort()).toEqual([...STORED[menu]].sort())
	})

	it("the three registries are those views", () => {
		expect(COLOR_SLOT_REGISTRY.map((d) => d.key)).toEqual(menuTargets("color").map((t) => t.key))
		expect(OPACITY_SLOT_REGISTRY.map((d) => d.key)).toEqual(
			menuTargets("opacity").map((t) => t.key)
		)
		expect(MODULATION_SLOT_REGISTRY.map((d) => d.key)).toEqual(
			menuTargets("modulation").map((t) => t.key)
		)
	})

	it("a target has one name and one part in every menu that offers it", () => {
		for (const row of PART_TARGETS)
			for (const menu of MENUS) {
				const view = menuTargets(menu).find((t) => t.key === row.key)
				if (!view) continue
				expect(view.label).toBe(row.label)
				expect(view.part).toBe(row.part)
			}
	})
})

/** Everything that switches a part on, switched on: Connection mapped with
 *  its points shown, the polygon filled, stems, and on the x axis a
 *  histogram with its rug and filled density curve, the violin / box
 *  overlay, the standalone density curve, and a regression with its band. */
const EVERYTHING_ON: { encodings: Encodings; configs: ChannelConfigs } = {
	encodings: { connection: { field: "series" } } as never,
	configs: {
		connection: { fillPolygon: true, axisStem: "x-axis", pointSampling: "all" },
		x: {
			histogram: { enabled: true, showRug: true, showDensity: true, densityFill: true },
			distributionOverlay: {
				showDensityViolin: true,
				showBoxPlot: true,
				showDensityCurve: true,
			},
			regression: { enabled: true, showCi: true },
		},
	} as never,
}
const NOTHING_ON: { encodings: Encodings; configs: ChannelConfigs } = {
	encodings: {} as never,
	configs: {},
}

const ALL_MODES = MODE_REGISTRY.map((m) => m.id).sort()

/** The chart types that offer each of a menu's targets, by key. */
const offeredOn = (
	menu: TargetMenu,
	{ encodings, configs }: { encodings: Encodings; configs: ChannelConfigs }
): Record<string, string[]> => {
	const out: Record<string, string[]> = {}
	for (const view of menuTargets(menu))
		out[view.key] = MODE_REGISTRY.filter((m) =>
			view.drawn({ canvas: m.canvas, encodings, configs })
		)
			.map((m) => m.id)
			.sort()
	return out
}

const LINE_CHARTS = ["combo-x", "combo-y", "radar", "scatter"]
const AREAS = ["areas-x", "areas-y"]
const COMBOS = ["combo-x", "combo-y"]
const DISTRIBUTIONS = ["bars-x", "bars-y", "scatter"]
const FLOWS = ["chord", "sankey"]

/** What every menu that keeps the target agrees on. */
const SHARED: Record<string, string[]> = {
	line: LINE_CHARTS,
	polygonFill: ["radar"],
	areaPointFill: AREAS,
	areaPointOutline: AREAS,
	comboPointFill: COMBOS,
	geoPointFill: ["geo-symbols"],
	geoPointStroke: ["geo-symbols"],
	geoRegionFill: ["geo-points"],
	geoRegionStroke: ["geo-points"],
	// Wherever "Connect points to axis" can draw them: the points of a
	// scatter or line chart, and of a bar + line combo.
	stem: ["combo-x", "combo-y", "scatter"],
	regressionStroke: ["scatter"],
	regressionCiFill: ["scatter"],
	violinFill: ["scatter"],
	violinStroke: ["scatter"],
	densityCurveFill: DISTRIBUTIONS,
	densityCurveStroke: DISTRIBUTIONS,
	rug: DISTRIBUTIONS,
	node: FLOWS,
	ribbon: FLOWS,
}

const expectedFor = (menu: TargetMenu, overrides: Record<string, string[]>) =>
	Object.fromEntries(STORED[menu].map((key) => [key, overrides[key] ?? SHARED[key]]))

describe("PART_TARGETS — offered where the chart draws the part", () => {
	it("Color", () => {
		expect(offeredOn("color", EVERYTHING_ON)).toEqual(expectedFor("color", {}))
	})

	it("Opacity: the marks' own outline (`border`) on every chart", () => {
		expect(offeredOn("opacity", EVERYTHING_ON)).toEqual(
			expectedFor("opacity", { border: ALL_MODES })
		)
	})

	it("Saturation / Brightness: an area chart's own outline is its `line`", () => {
		expect(offeredOn("modulation", EVERYTHING_ON)).toEqual(
			expectedFor("modulation", {
				outline: ALL_MODES.filter((m) => !AREAS.includes(m)),
				line: [...AREAS, ...LINE_CHARTS].sort(),
			})
		)
	})

	it("with nothing switched on, only what a chart always draws is offered", () => {
		const always: Record<string, string[]> = {
			border: ALL_MODES,
			outline: ALL_MODES.filter((m) => !AREAS.includes(m)),
			comboPointFill: COMBOS,
			geoPointFill: ["geo-symbols"],
			geoPointStroke: ["geo-symbols"],
			geoRegionFill: ["geo-points"],
			geoRegionStroke: ["geo-points"],
			node: FLOWS,
			ribbon: FLOWS,
		}
		for (const menu of MENUS)
			expect(offeredOn(menu, NOTHING_ON)).toEqual(
				Object.fromEntries(STORED[menu].map((key) => [key, always[key] ?? []]))
			)
	})
})
