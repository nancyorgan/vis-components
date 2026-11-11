import { describe, expect, it } from "vitest"

import { DEFAULT_CONNECTION_CONFIG, EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { AreasXMode } from "./chartModes/areasX"
import { ComboXMode } from "./chartModes/comboX"
import { RadarMode } from "./chartModes/radar"
import { ScatterMode } from "./chartModes/scatter"
import { applicableColorSlots } from "./colorSlots"
import { markPartTitles } from "./markPartTitles"
import { applicableModulationSlots } from "./modulationSlots"
import { applicableOpacitySlots } from "./opacitySlots"
import { emptyEncodings } from "./types"

const withConnection = { ...emptyEncodings(), connection: { field: "series" } }

describe("markPartTitles", () => {
	it("names a line chart's fill and outline as the points'", () => {
		expect(markPartTitles(ScatterMode, EMPTY_CHANNEL_CONFIGS, withConnection)).toEqual({
			fill: "Point fill",
			outline: "Point outline",
			line: "Line",
		})
	})

	it("keeps the plain names on a scatter with no Connection line", () => {
		expect(markPartTitles(ScatterMode, EMPTY_CHANNEL_CONFIGS, emptyEncodings())).toEqual({
			fill: "Fill",
			outline: "Outline",
			line: "Line",
		})
	})

	it("keeps the plain names on the bar + line combo, whose Fill is the bars'", () => {
		expect(markPartTitles(ComboXMode, EMPTY_CHANNEL_CONFIGS, withConnection).fill).toBe("Fill")
	})

	it("names an area chart's body the Area fill (once filled) and its edge the Line", () => {
		const filled = { connection: { ...DEFAULT_CONNECTION_CONFIG, fill: "area" as const } }
		expect(markPartTitles(AreasXMode, filled, withConnection)).toEqual({
			fill: "Area fill",
			outline: "Line",
			line: "Line",
		})
		expect(markPartTitles(AreasXMode, EMPTY_CHANNEL_CONFIGS, withConnection).fill).toBe("Fill")
	})

	it("offers the area Point fill / Point outline parts only while points draw", () => {
		const keys = (pointSampling: "all" | "none") => {
			const configs = { connection: { ...DEFAULT_CONNECTION_CONFIG, pointSampling } }
			return {
				color: applicableColorSlots("areas-x", withConnection, configs).map((d) => d.key),
				opacity: applicableOpacitySlots("areas-x", withConnection, configs).map((d) => d.key),
				modulation: applicableModulationSlots("areas-x", withConnection, configs).map(
					(d) => d.key
				),
			}
		}
		expect(keys("all")).toEqual({
			// Point outline is not a color slot: it is the marks' own outline.
			color: ["areaPointFill"],
			opacity: ["areaPointFill", "border", "areaPointOutline"],
			modulation: ["areaPointFill", "line", "areaPointOutline"],
		})
		expect(keys("none")).toEqual({ color: [], opacity: ["border"], modulation: ["line"] })
		// A line chart's points are the marks themselves — no area parts there.
		expect(
			applicableColorSlots("scatter", withConnection, EMPTY_CHANNEL_CONFIGS).map((d) => d.key)
		).not.toContain("areaPointFill")
	})

	it("names the radar polygon's outline the Connection line", () => {
		expect(markPartTitles(RadarMode, EMPTY_CHANNEL_CONFIGS, withConnection).line).toBe(
			"Connection line"
		)
	})
})
