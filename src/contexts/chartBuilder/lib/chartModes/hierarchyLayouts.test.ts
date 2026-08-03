import { describe, expect, it } from "vitest"

import { getChartMode } from "../chartMode"
import type { ChannelConfigs } from "../channelConfig"
import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { emptyEncodings } from "../types"
import { PackedCirclesMode } from "./packedCircles"
import { SunburstMode } from "./sunburst"
import { TreemapMode } from "./treemap"

const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

const HIER_ENC = {
	...emptyEncodings(),
	connection: { field: "parent" },
	area: { field: "value" },
}

const layoutCfg = (
	layout: "pack" | "treemap" | "sunburst" | undefined
): ChannelConfigs => ({ connection: { hierarchyLayout: layout } as never })

describe("hierarchy layout routing (one signature, config-gated modes)", () => {
	it("defaults to packed circles when the layout config is absent (saved visuals unchanged)", () => {
		expect(getChartMode(HIER_ENC)).toBe("packed-circles")
		expect(getChartMode(HIER_ENC, undefined, {})).toBe("packed-circles")
		expect(getChartMode(HIER_ENC, undefined, layoutCfg(undefined))).toBe(
			"packed-circles"
		)
	})

	it("routes to treemap / sunburst via connection.hierarchyLayout", () => {
		expect(getChartMode(HIER_ENC, undefined, layoutCfg("treemap"))).toBe(
			"treemap"
		)
		expect(getChartMode(HIER_ENC, undefined, layoutCfg("sunburst"))).toBe(
			"sunburst"
		)
		expect(getChartMode(HIER_ENC, undefined, layoutCfg("pack"))).toBe(
			"packed-circles"
		)
	})

	it("the three layouts are mutually exclusive on the same encodings", () => {
		for (const [layout, winner] of [
			["pack", PackedCirclesMode],
			["treemap", TreemapMode],
			["sunburst", SunburstMode],
		] as const) {
			const cfg = layoutCfg(layout)
			expect(PackedCirclesMode.detect(HIER_ENC, undefined, cfg)).toBe(
				winner === PackedCirclesMode
			)
			expect(TreemapMode.detect(HIER_ENC, undefined, cfg)).toBe(
				winner === TreemapMode
			)
			expect(SunburstMode.detect(HIER_ENC, undefined, cfg)).toBe(
				winner === SunburstMode
			)
		}
	})

	it("flat (area-only) signature honors the layout too", () => {
		const flat = { ...emptyEncodings(), area: { field: "value" } }
		expect(getChartMode(flat, undefined, layoutCfg("treemap"))).toBe("treemap")
	})

	it("geographic coords still win the signature (bubble map)", () => {
		expect(
			getChartMode(HIER_ENC, undefined, layoutCfg("treemap"), geo)
		).toBe("geo-symbols")
	})

	it("positions break the signature regardless of layout", () => {
		const withX = { ...HIER_ENC, x: { field: "a" } }
		expect(getChartMode(withX, undefined, layoutCfg("sunburst"))).toBe(
			"scatter"
		)
	})

	it("treemap / sunburst share packed circles' legend + canvas traits", () => {
		for (const mode of [TreemapMode, SunburstMode]) {
			expect(mode.legend.hideConnectionInThisMode).toBe(true)
			expect(mode.canvas.coordFamily).toBe("cartesian")
			expect(mode.canvas.measureAxis).toBeNull()
		}
	})
})
