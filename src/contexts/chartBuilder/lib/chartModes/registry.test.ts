import { describe, expect, it } from "vitest"

// Import `../chartMode` first to prime the module graph in the order that
// avoids a circular-init between types.ts, channels.ts, and atoms.ts. The
// sibling chartMode.test.ts relies on the same ordering.
import "../chartMode"
import { emptyEncodings } from "../types"
import { AreasXMode } from "./areasX"
import { AreasYMode } from "./areasY"
import { BarsXMode } from "./barsX"
import { BarsYMode } from "./barsY"
import { MODE_REGISTRY } from "./index"
import { PiesMode } from "./pies"
import { PiesXMode } from "./piesX"
import { PiesYMode } from "./piesY"
import { RadarMode } from "./radar"
import { GeoChoroplethMode } from "./geoChoropleth"
import { ScatterMode } from "./scatter"
import { TileMode } from "./tile"

const enc = (overrides: Record<string, string>) => {
	const e = emptyEncodings()
	for (const [ch, field] of Object.entries(overrides)) {
		;(e as Record<string, { field: string | null }>)[ch] = { field }
	}
	return e
}

describe("MODE_REGISTRY", () => {
	it("is non-empty", () => {
		expect(MODE_REGISTRY.length).toBeGreaterThan(0)
	})

	it("has unique ids across all registered modes", () => {
		const ids = MODE_REGISTRY.map((m) => m.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	// Renderer components are bound on the components side
	// (components/viz/rendererRegistry.ts) so this registry stays React-free;
	// rendererRegistry.test.ts pins that every registered id has a binding.

	it("ends with ScatterMode (the fallback) as the last registered mode", () => {
		expect(MODE_REGISTRY.at(-1)).toBe(ScatterMode)
	})
})

describe("ScatterMode.detect", () => {
	it("returns true for empty encodings (fallback)", () => {
		expect(ScatterMode.detect(emptyEncodings())).toBe(true)
	})

	it("returns true for x+length (even though a more-specific mode would match first)", () => {
		expect(ScatterMode.detect(enc({ x: "a", length: "b" }))).toBe(true)
	})
})

describe("bars detect predicates", () => {
	it("BarsX and BarsY are mutually exclusive for x+length", () => {
		const e = enc({ x: "a", length: "b" })
		expect(BarsXMode.detect(e)).toBe(true)
		expect(BarsYMode.detect(e)).toBe(false)
	})

	it("BarsX and BarsY are mutually exclusive for y+length", () => {
		const e = enc({ y: "a", length: "b" })
		expect(BarsXMode.detect(e)).toBe(false)
		expect(BarsYMode.detect(e)).toBe(true)
	})
})

describe("pies detect predicates", () => {
	it("PiesX and PiesY are mutually exclusive for x+angle", () => {
		const e = enc({ x: "a", angle: "b" })
		expect(PiesXMode.detect(e)).toBe(true)
		expect(PiesYMode.detect(e)).toBe(false)
		expect(PiesMode.detect(e)).toBe(false)
	})

	it("PiesX and PiesY are mutually exclusive for y+angle", () => {
		const e = enc({ y: "a", angle: "b" })
		expect(PiesXMode.detect(e)).toBe(false)
		expect(PiesYMode.detect(e)).toBe(true)
		expect(PiesMode.detect(e)).toBe(false)
	})

	it("PiesMode detects when angle is mapped without x, y, or length", () => {
		expect(PiesMode.detect(enc({ angle: "a" }))).toBe(true)
		expect(PiesMode.detect(enc({ angle: "a", hue: "b" }))).toBe(true)
	})

	it("PiesMode does NOT detect when x, y, or length are also mapped", () => {
		expect(PiesMode.detect(enc({ angle: "a", x: "b" }))).toBe(false)
		expect(PiesMode.detect(enc({ angle: "a", y: "b" }))).toBe(false)
		expect(PiesMode.detect(enc({ angle: "a", length: "b" }))).toBe(false)
	})

	it("PiesMode ignores facet (orthogonal) — facet + angle still detects as pies", () => {
		expect(PiesMode.detect(enc({ angle: "a", facet: "b" }))).toBe(true)
	})
})

describe("length + angle together with x only (vector fields)", () => {
	it("neither bars-x nor pies-x detects (falls through to scatter)", () => {
		const e = enc({ x: "a", length: "b", angle: "c" })
		expect(BarsXMode.detect(e)).toBe(false)
		expect(PiesXMode.detect(e)).toBe(false)
	})
})

describe("RadarMode.detect", () => {
	it("detects on r + angle with no x or y", () => {
		expect(RadarMode.detect(enc({ r: "a", angle: "b" }))).toBe(true)
	})

	it("ignores facet (orthogonal) — facet alongside r + angle still detects radar", () => {
		expect(RadarMode.detect(enc({ r: "a", angle: "b", facet: "c" }))).toBe(true)
	})

	it("tolerates connection / hue alongside r + angle", () => {
		expect(
			RadarMode.detect(enc({ r: "a", angle: "b", connection: "c", hue: "d" })),
		).toBe(true)
	})

	it("does NOT detect when x is also mapped", () => {
		expect(RadarMode.detect(enc({ r: "a", angle: "b", x: "c" }))).toBe(false)
	})

	it("does NOT detect when y is also mapped", () => {
		expect(RadarMode.detect(enc({ r: "a", angle: "b", y: "c" }))).toBe(false)
	})

	it("does NOT detect without an r encoding", () => {
		expect(RadarMode.detect(enc({ angle: "b" }))).toBe(false)
	})

	it("does NOT detect without an angle encoding", () => {
		expect(RadarMode.detect(enc({ r: "a" }))).toBe(false)
	})

	it("hides the angle legend section in radar mode", () => {
		expect(RadarMode.legend.hideAngleInThisMode).toBe(true)
	})

	it("disjoint from PiesMode — pies requires no r", () => {
		const e = enc({ r: "a", angle: "b" })
		expect(RadarMode.detect(e)).toBe(true)
		expect(PiesMode.detect(e)).toBe(false)
	})
})

describe("areas detect predicates", () => {
	it("AreasX detects on x + length + connection (no y, no angle)", () => {
		const e = enc({ x: "a", length: "b", connection: "c" })
		expect(AreasXMode.detect(e)).toBe(true)
		expect(AreasYMode.detect(e)).toBe(false)
	})

	it("AreasY detects on y + length + connection (no x, no angle)", () => {
		const e = enc({ y: "a", length: "b", connection: "c" })
		expect(AreasYMode.detect(e)).toBe(true)
		expect(AreasXMode.detect(e)).toBe(false)
	})

	it("AreasX does NOT detect without a connection encoding", () => {
		expect(AreasXMode.detect(enc({ x: "a", length: "b" }))).toBe(false)
	})

	it("AreasX does NOT detect when angle is also mapped (angle blocks area)", () => {
		const e = enc({ x: "a", length: "b", connection: "c", angle: "d" })
		expect(AreasXMode.detect(e)).toBe(false)
	})

	it("AreasX does NOT detect when both x and y are mapped", () => {
		const e = enc({ x: "a", y: "b", length: "c", connection: "d" })
		expect(AreasXMode.detect(e)).toBe(false)
	})

	it("AreasX does NOT detect x + y + connection (with or without hue) — area is opt-in via length", () => {
		// Previous behavior auto-routed x + y + connection + hue to
		// areas-x. That surprised users building line charts who added
		// hue to color lines and got an area chart instead. Area mode
		// is now opt-in via the `length` encoding; y-based area
		// detection is gone.
		const noHue = enc({ x: "a", y: "b", connection: "c" })
		expect(AreasXMode.detect(noHue)).toBe(false)
		const withHue = enc({ x: "a", y: "b", connection: "c", hue: "h" })
		expect(AreasXMode.detect(withHue)).toBe(false)
		expect(AreasYMode.detect(withHue)).toBe(false)
	})

	it("AreasX does NOT detect on x + y + connection when length is also mapped (ambiguous)", () => {
		const e = enc({ x: "a", y: "b", length: "c", connection: "d" })
		expect(AreasXMode.detect(e)).toBe(false)
	})

	it("AreasX does NOT detect on x + y + connection when angle is also mapped", () => {
		const e = enc({ x: "a", y: "b", connection: "c", angle: "d" })
		expect(AreasXMode.detect(e)).toBe(false)
	})

	it("AreasY still requires length (y-based form does not apply to areas-y)", () => {
		// areas-y is orientation-fixed on length; x+y+connection doesn't qualify.
		const e = enc({ x: "a", y: "b", connection: "c" })
		expect(AreasYMode.detect(e)).toBe(false)
	})
})

describe("TileMode.detect", () => {
	const catGetType = () => "categorical" as const
	const quantGetType = () => "quantitative" as const

	it("detects when x and y are categorical and hue is mapped", () => {
		const e = enc({ x: "a", y: "b", hue: "c" })
		expect(TileMode.detect(e, catGetType)).toBe(true)
	})

	it("detects when x and y are categorical and text is mapped", () => {
		const e = enc({ x: "a", y: "b", text: "c" })
		expect(TileMode.detect(e, catGetType)).toBe(true)
	})

	it("does NOT detect when y is quantitative (strip plot territory)", () => {
		const e = enc({ x: "a", y: "b", hue: "c" })
		const mixedGetType = (f: string) =>
			f === "b" ? ("quantitative" as const) : ("categorical" as const)
		expect(TileMode.detect(e, mixedGetType)).toBe(false)
	})

	it("does NOT detect when both axes are quantitative (scatter+hue)", () => {
		const e = enc({ x: "a", y: "b", hue: "c" })
		expect(TileMode.detect(e, quantGetType)).toBe(false)
	})

	it("does NOT detect without hue or text", () => {
		const e = enc({ x: "a", y: "b" })
		expect(TileMode.detect(e, catGetType)).toBe(false)
	})

	it("does NOT detect when getType is omitted (safer default)", () => {
		const e = enc({ x: "a", y: "b", hue: "c" })
		expect(TileMode.detect(e)).toBe(false)
	})

	it("does NOT detect when a glyph attribute is mapped (e.g. area)", () => {
		const e = enc({ x: "a", y: "b", hue: "c", area: "d" })
		expect(TileMode.detect(e, catGetType)).toBe(false)
	})
})

describe("MODE_REGISTRY precedence & metadata", () => {
	it("includes AreasXMode and AreasYMode", () => {
		expect(MODE_REGISTRY).toContain(AreasXMode)
		expect(MODE_REGISTRY).toContain(AreasYMode)
	})

	it("registers areas BEFORE bars so `x + length + connection` detects as areas, not bars", () => {
		const areasXIdx = MODE_REGISTRY.indexOf(AreasXMode)
		const barsXIdx = MODE_REGISTRY.indexOf(BarsXMode)
		const areasYIdx = MODE_REGISTRY.indexOf(AreasYMode)
		const barsYIdx = MODE_REGISTRY.indexOf(BarsYMode)
		expect(areasXIdx).toBeLessThan(barsXIdx)
		expect(areasYIdx).toBeLessThan(barsYIdx)
	})

	it("enables supportsSharedMeasureMax for area modes", () => {
		expect(AreasXMode.facet.supportsSharedMeasureMax).toBe(true)
		expect(AreasYMode.facet.supportsSharedMeasureMax).toBe(true)
	})

	it("scopes the stack-mode toggle to bar/area modes via supportsSharedMeasureMax", () => {
		// ColorOptionsPanel uses `supportsSharedMeasureMax` as the gate for the
		// stack/group/overlay control: it makes sense for stackable
		// orientations (bars + areas) and not for anything else. If the flag
		// drifts ON for a non-stackable mode, the sidebar will surface a
		// control that does nothing — so this test pins the per-mode gating.
		expect(BarsXMode.facet.supportsSharedMeasureMax).toBe(true)
		expect(BarsYMode.facet.supportsSharedMeasureMax).toBe(true)
		expect(AreasXMode.facet.supportsSharedMeasureMax).toBe(true)
		expect(AreasYMode.facet.supportsSharedMeasureMax).toBe(true)

		expect(ScatterMode.facet.supportsSharedMeasureMax).toBe(false)
		expect(PiesMode.facet.supportsSharedMeasureMax).toBe(false)
		expect(PiesXMode.facet.supportsSharedMeasureMax).toBe(false)
		expect(PiesYMode.facet.supportsSharedMeasureMax).toBe(false)
		expect(TileMode.facet.supportsSharedMeasureMax).toBe(false)
	})

	it("hides the length legend section for area modes (redundant with measure axis)", () => {
		expect(AreasXMode.legend.hideLengthInThisMode).toBe(true)
		expect(AreasYMode.legend.hideLengthInThisMode).toBe(true)
	})

	it("reverses categorical legend order for the VERTICAL area mode only (top swatch aligns with top of stack)", () => {
		// areas-x stacks bottom→top, so the legend reverses to put the top-of-
		// stack swatch first. areas-y stacks left→right, so discovery order
		// already matches the bar — no reversal.
		expect(AreasXMode.legend.reverseCategoricalOrder).toBe(true)
		expect(AreasYMode.legend.reverseCategoricalOrder).toBe(false)
	})

	it("hides the connection legend section in geographic mode (connection is the region key, not a series)", () => {
		expect(GeoChoroplethMode.legend.hideConnectionInThisMode).toBe(true)
	})

	it("does NOT hide the connection legend in non-geographic modes", () => {
		expect(ScatterMode.legend.hideConnectionInThisMode).toBe(false)
		expect(AreasXMode.legend.hideConnectionInThisMode).toBe(false)
		expect(RadarMode.legend.hideConnectionInThisMode).toBe(false)
	})

	it("defaults the Size legend to hidden in flow + hierarchy modes only (size is the diagram's geometry there)", () => {
		const defaultHiddenIds = new Set(
			MODE_REGISTRY.filter((m) => m.legend.areaHiddenByDefault === true).map(
				(m) => m.id
			)
		)
		expect(defaultHiddenIds).toEqual(
			new Set(["sankey", "chord", "packed-circles", "treemap", "sunburst"])
		)
	})
})

describe("canvas traits", () => {
	// PlotCanvas never branches on mode ids — it reads these declarative
	// traits. Every registered mode must declare a coherent set, so a new
	// mode can't silently fall through the canvas's layout decisions.
	it("every mode declares a coordFamily and measureAxis", () => {
		for (const mode of MODE_REGISTRY) {
			expect(["cartesian", "polar", "geo"]).toContain(mode.canvas.coordFamily)
			expect([null, "x", "y"]).toContain(mode.canvas.measureAxis)
		}
	})

	it("measure-axis modes (bars/areas) resolve a measure field; others don't declare one", () => {
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.measureAxis !== null) {
				expect(mode.canvas.resolveMeasureField).toBeTypeOf("function")
			} else {
				expect(mode.canvas.resolveMeasureField).toBeUndefined()
			}
		}
	})

	it("polar modes declare a polarUnit; non-polar modes don't", () => {
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.coordFamily === "polar") {
				expect(["rAxisMax", "angleSum"]).toContain(mode.canvas.polarUnit)
			} else {
				expect(mode.canvas.polarUnit).toBeUndefined()
			}
		}
	})

	it("orientation traits match the mode ids they replaced", () => {
		// The measure axis is the OPPOSITE pixel axis from the category:
		// bars-x/areas-x (vertical, categories on x) measure on y.
		expect(BarsXMode.canvas.measureAxis).toBe("y")
		expect(AreasXMode.canvas.measureAxis).toBe("y")
		expect(BarsYMode.canvas.measureAxis).toBe("x")
		expect(AreasYMode.canvas.measureAxis).toBe("x")
		expect(ScatterMode.canvas.measureAxis).toBeNull()
		expect(TileMode.canvas.measureAxis).toBeNull()

		expect(RadarMode.canvas.polarUnit).toBe("rAxisMax")
		expect(PiesMode.canvas.polarUnit).toBe("angleSum")
		expect(GeoChoroplethMode.canvas.coordFamily).toBe("geo")
	})

	it("measure-field fallback chains are per-mode (bars/areas read `length` first)", () => {
		const enc = {
			...emptyEncodings(),
			x: { field: "fx" },
			y: { field: "fy" },
			length: { field: "flen" },
		}
		// Bars measure from the length channel only: bars-x/bars-y detection
		// requires the measure-pixel-axis position channel to be UNMAPPED, so
		// reading it would always yield null (which collapsed the shared
		// faceted measure max to 1 and rendered every bar full-height).
		expect(BarsXMode.canvas.resolveMeasureField?.(enc)).toBe("flen")
		expect(BarsYMode.canvas.resolveMeasureField?.(enc)).toBe("flen")
		expect(AreasXMode.canvas.resolveMeasureField?.(enc)).toBe("flen")
		expect(AreasYMode.canvas.resolveMeasureField?.(enc)).toBe("flen")
		// areas-x falls back to y when length is unmapped; areas-y does NOT
		// fall back to x (x is its measure PIXEL axis, not a field source).
		const noLen = { ...enc, length: { field: null } }
		expect(AreasXMode.canvas.resolveMeasureField?.(noLen)).toBe("fy")
		expect(AreasYMode.canvas.resolveMeasureField?.(noLen)).toBeNull()
	})

	it("only radar renders value annotations in the renderer", () => {
		for (const mode of MODE_REGISTRY) {
			expect(mode.canvas.valueAnnotationsInRenderer ?? false).toBe(
				mode.id === "radar",
			)
		}
	})
})
