import { describe, expect, it } from "vitest"

import { getChartMode } from "../chartMode"
import type { ChannelConfigs } from "../channelConfig"
import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { emptyEncodings } from "../types"
import { ChordMode } from "./chord"
import { PackedCirclesMode } from "./packedCircles"
import { SankeyMode } from "./sankey"
import { SunburstMode } from "./sunburst"
import { TreemapMode } from "./treemap"

const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

const FLOW_ENC = {
	...emptyEncodings(),
	connection: { field: "Start" },
	area: { field: "Value" },
}

const layoutCfg = (
	layout: "pack" | "treemap" | "sunburst" | "chord" | "sankey" | undefined
): ChannelConfigs => ({ connection: { hierarchyLayout: layout } as never })

describe("flow layout routing (the shared signature, config-gated modes)", () => {
	it("routes to chord / sankey via connection.hierarchyLayout", () => {
		expect(getChartMode(FLOW_ENC, undefined, layoutCfg("chord"))).toBe("chord")
		expect(getChartMode(FLOW_ENC, undefined, layoutCfg("sankey"))).toBe(
			"sankey"
		)
	})

	it("absent layout still defaults to packed circles (saved visuals unchanged)", () => {
		expect(getChartMode(FLOW_ENC)).toBe("packed-circles")
		expect(getChartMode(FLOW_ENC, undefined, {})).toBe("packed-circles")
		expect(getChartMode(FLOW_ENC, undefined, layoutCfg(undefined))).toBe(
			"packed-circles"
		)
	})

	it("all five layouts are mutually exclusive on the same encodings", () => {
		const modes = [
			PackedCirclesMode,
			TreemapMode,
			SunburstMode,
			ChordMode,
			SankeyMode,
		] as const
		for (const [layout, winner] of [
			["pack", PackedCirclesMode],
			["treemap", TreemapMode],
			["sunburst", SunburstMode],
			["chord", ChordMode],
			["sankey", SankeyMode],
		] as const) {
			const cfg = layoutCfg(layout)
			for (const mode of modes) {
				expect(mode.detect(FLOW_ENC, undefined, cfg)).toBe(mode === winner)
			}
		}
	})

	it("geographic coords still win the signature (bubble map)", () => {
		expect(getChartMode(FLOW_ENC, undefined, layoutCfg("chord"), geo)).toBe(
			"geo-symbols"
		)
	})

	it("positions break the signature regardless of layout", () => {
		const withX = { ...FLOW_ENC, x: { field: "a" } }
		expect(getChartMode(withX, undefined, layoutCfg("sankey"))).toBe("scatter")
	})

	it("flow modes share the hierarchy legend + canvas traits", () => {
		for (const mode of [ChordMode, SankeyMode]) {
			expect(mode.legend.hideConnectionInThisMode).toBe(true)
			expect(mode.canvas.coordFamily).toBe("cartesian")
			expect(mode.canvas.measureAxis).toBeNull()
		}
	})
})
