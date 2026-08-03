import { describe, expect, it } from "vitest"

import { getChartMode } from "../chartMode"
import { DEFAULT_MAP_CONFIG } from "../mapConfig"
import { emptyEncodings } from "../types"
import { PackedCirclesMode } from "./packedCircles"

const geo = { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" as const }

describe("PackedCirclesMode.detect", () => {
	it("true when area is the only positional-ish channel mapped (flat pack)", () => {
		const e = { ...emptyEncodings(), area: { field: "value" } }
		expect(PackedCirclesMode.detect(e)).toBe(true)
	})

	it("true with connection alongside area (grouped / nested pack)", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "parent" },
			area: { field: "value" },
		}
		expect(PackedCirclesMode.detect(e)).toBe(true)
	})

	it("tolerates aesthetic channels (hue / opacity / facet)", () => {
		const e = {
			...emptyEncodings(),
			area: { field: "value" },
			hue: { field: "group" },
			opacity: { field: "value" },
			facet: { field: "region" },
		}
		expect(PackedCirclesMode.detect(e)).toBe(true)
	})

	it.each(["x", "y", "r", "angle", "length"] as const)(
		"false when %s is also mapped (positions win)",
		(ch) => {
			const e = {
				...emptyEncodings(),
				area: { field: "value" },
				[ch]: { field: "f" },
			}
			expect(PackedCirclesMode.detect(e)).toBe(false)
		}
	)

	it("false without area (nothing to size by)", () => {
		const e = { ...emptyEncodings(), connection: { field: "parent" } }
		expect(PackedCirclesMode.detect(e)).toBe(false)
	})

	it("stands down under geographic coords (that signature is the bubble map)", () => {
		const e = {
			...emptyEncodings(),
			connection: { field: "state" },
			area: { field: "pop" },
		}
		expect(PackedCirclesMode.detect(e, undefined, undefined, geo)).toBe(false)
		// End-to-end through the registry: geographic → geo-symbols wins.
		expect(getChartMode(e, undefined, undefined, geo)).toBe("geo-symbols")
	})

	it("ROUTING: area-only and connection+area resolve to packed-circles through the registry", () => {
		expect(getChartMode({ ...emptyEncodings(), area: { field: "v" } })).toBe(
			"packed-circles"
		)
		expect(
			getChartMode({
				...emptyEncodings(),
				connection: { field: "p" },
				area: { field: "v" },
			})
		).toBe("packed-circles")
	})

	it("ROUTING: x + area is still scatter (sized dots need positions)", () => {
		expect(
			getChartMode({
				...emptyEncodings(),
				x: { field: "a" },
				area: { field: "v" },
			})
		).toBe("scatter")
	})
})

describe("PackedCirclesMode metadata", () => {
	it("hides the connection legend (connection is the hierarchy key, not a series)", () => {
		expect(PackedCirclesMode.legend.hideConnectionInThisMode).toBe(true)
	})

	it("declares an axis-less cartesian panel with no measure axis", () => {
		expect(PackedCirclesMode.canvas.coordFamily).toBe("cartesian")
		expect(PackedCirclesMode.canvas.measureAxis).toBeNull()
	})
})
