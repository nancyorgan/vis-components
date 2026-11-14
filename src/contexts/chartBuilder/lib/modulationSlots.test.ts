import { describe, expect, it } from "vitest"
import type { AestheticScales } from "../store/useAestheticScales"

import type { ChannelConfigs } from "./channelConfig"
import {
	applicableModulationSlots,
	modulationSlotEdited,
} from "./modulationSlots"
import { slotModulationResolver } from "./resolveLayerColor"
import { makeSaturationScale, modulateColor } from "./scales"
import type { Encodings } from "./types"

const emptyScales: AestheticScales = {
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

const RED = "#cc3333"

describe("modulationSlotEdited", () => {
	it("treats absent / off slots as untouched", () => {
		expect(modulationSlotEdited(undefined)).toBe(false)
		expect(modulationSlotEdited({ field: null, level: null })).toBe(false)
	})
	it("dots on a level or a mapped field", () => {
		expect(modulationSlotEdited({ field: null, level: 0.2 })).toBe(true)
		expect(modulationSlotEdited({ field: "g", level: null })).toBe(true)
	})
})

describe("applicableModulationSlots", () => {
	const enc = (connection: string | null) =>
		({ connection: { field: connection } }) as unknown as Encodings
	it("offers Outline on scatter, and Line only with a connection", () => {
		expect(
			applicableModulationSlots("scatter", enc(null), {}).map((d) => d.key)
		).toEqual(["outline"])
		expect(
			applicableModulationSlots("scatter", enc("series"), {}).map((d) => d.key)
		).toEqual(["outline", "line"])
	})
	it("offers the marks' own outline on every mode that is not an area chart", () => {
		// Every renderer resolves its outline through `lib/markOutline`, which
		// applies the outline's saturation and brightness.
		for (const mode of ["bars-x", "pies", "tile", "hexbin", "treemap", "chord", "geo-choropleth"] as const)
			expect(
				applicableModulationSlots(mode, enc("series"), {}).map((d) => d.key),
				mode
			).toEqual(["outline"])
		// An area's own outline is its Line; the points on it have their own target.
		expect(
			applicableModulationSlots("areas-x", enc("series"), {}).map((d) => d.key)
		).not.toContain("outline")
	})
	it("offers the Violin / box fill + outline pair only while an overlay is on", () => {
		const boxOn = {
			y: { distributionOverlay: { showBoxPlot: true } },
		} as unknown as ChannelConfigs
		expect(
			applicableModulationSlots("scatter", enc(null), boxOn).map((d) => d.key)
		).toEqual(["outline", "violinFill", "violinStroke"])
		// The overlay draws on scatter only: a stale flag on a bar chart adds nothing.
		expect(
			applicableModulationSlots("bars-x", enc(null), boxOn).map((d) => d.key)
		).toEqual(["outline"])
	})
})

describe("slotModulationResolver", () => {
	it("is the identity when no slot is set", () => {
		const mod = slotModulationResolver("outline", {}, emptyScales)
		expect(mod(RED, {})).toBe(RED)
	})

	it("applies a static level, independent of the other part", () => {
		const configs: ChannelConfigs = {
			saturationSlots: { line: { field: null, level: 0.1 } },
			brightnessSlots: { line: { field: null, level: 0.8 } },
		}
		const line = slotModulationResolver("line", configs, emptyScales)
		const outline = slotModulationResolver("outline", configs, emptyScales)
		expect(line(RED, {})).toBe(modulateColor(RED, 0.1, 0.8))
		expect(outline(RED, {})).toBe(RED)
	})

	it("reads a mapped field per row", () => {
		const range = { min: 0, max: 1 }
		const configs: ChannelConfigs = {
			saturationSlots: { outline: { field: "g", level: null, range } },
		}
		const scales: AestheticScales = {
			...emptyScales,
			saturationSlots: {
				outline: {
					scale: makeSaturationScale(["a", "b"], "categorical", range),
					field: { name: "g", type: "categorical" },
				},
			},
		}
		const mod = slotModulationResolver("outline", configs, scales)
		expect(mod(RED, { g: "a" })).toBe(modulateColor(RED, 0, null))
		expect(mod(RED, { g: "b" })).toBe(modulateColor(RED, 1, null))
	})

	it("leaves a hollow ('none') stroke alone", () => {
		const configs: ChannelConfigs = {
			saturationSlots: { outline: { field: null, level: 0 } },
		}
		expect(slotModulationResolver("outline", configs, emptyScales)("none", {})).toBe(
			"none"
		)
	})
})
