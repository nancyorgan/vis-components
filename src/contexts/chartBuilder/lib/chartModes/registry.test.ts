import { describe, expect, it } from "vitest"

// Import `../chartMode` first to prime the module graph in the order that
// avoids a circular-init between types.ts, channels.ts, and atoms.ts. The
// sibling chartMode.test.ts relies on the same ordering.
import "../chartMode"
import { getChartMode } from "../chartMode"
import { emptyEncodings } from "../types"
import { AreasXMode } from "./areasX"
import { AreasYMode } from "./areasY"
import { BarsXMode } from "./barsX"
import { BarsYMode } from "./barsY"
import { ComboXMode } from "./comboX"
import { ComboYMode } from "./comboY"
import { FAMILY_MODE_IDS, isFlowModeId, isStructureModeId } from "./families"
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

describe("bar + marks combo detect predicates", () => {
	const types: Record<string, "quantitative" | "categorical"> = {
		month: "categorical",
		region: "categorical",
		units: "quantitative",
		revenue: "quantitative",
	}
	const getType = (f: string) => types[f]
	const asBars = { length: { minLength: 4, maxLength: 40, render: "bars" as const } }
	const xyl = enc({ x: "month", y: "revenue", length: "units" })

	it("x + y + length WITHOUT the Draw-as opt-in stays the segment scatter", () => {
		expect(getChartMode(xyl, getType)).toBe("scatter")
		expect(getChartMode(xyl, getType, { length: { minLength: 4, maxLength: 40 } })).toBe("scatter")
		expect(ComboXMode.detect(xyl, getType, {})).toBe(false)
		expect(ComboYMode.detect(xyl, getType, {})).toBe(false)
	})

	it("categorical x + quantitative y + length, drawn as bars → combo-x (vertical bars, y as marks)", () => {
		expect(getChartMode(xyl, getType, asBars)).toBe("combo-x")
		expect(ComboYMode.detect(xyl, getType, asBars)).toBe(false)
	})

	it("quantitative x + categorical y → combo-y (horizontal bars, x as marks)", () => {
		const e = enc({ x: "revenue", y: "region", length: "units" })
		expect(getChartMode(e, getType, asBars)).toBe("combo-y")
		expect(ComboXMode.detect(e, getType, asBars)).toBe(false)
	})

	it("both positions quantitative (or no type lookup) → combo-x, the common vertical combo", () => {
		const e = enc({ x: "revenue", y: "units", length: "units" })
		expect(getChartMode(e, getType, asBars)).toBe("combo-x")
		expect(getChartMode(xyl, undefined, asBars)).toBe("combo-x")
	})

	it("angle or r alongside the signature blocks the combo (vector field / radar stay theirs)", () => {
		expect(
			getChartMode(enc({ x: "month", y: "revenue", length: "units", angle: "units" }), getType, asBars)
		).toBe("scatter")
		expect(ComboXMode.detect(enc({ x: "month", y: "revenue", length: "units", r: "units" }), getType, asBars)).toBe(false)
	})

	it("needs all three of x, y and length — bars and segments never read the opt-in", () => {
		expect(getChartMode(enc({ x: "month", length: "units" }), getType, asBars)).toBe("bars-x")
		expect(getChartMode(enc({ y: "month", length: "units" }), getType, asBars)).toBe("bars-y")
		expect(getChartMode(enc({ x: "month", y: "revenue" }), getType, asBars)).toBe("scatter")
	})

	it("declares bar-family traits plus scatter's line / glyph / mark roles for the marks layer", () => {
		for (const mode of [ComboXMode, ComboYMode]) {
			expect(mode.canvas.lengthRole, mode.id).toBe("measure")
			expect(mode.canvas.connectionRole, mode.id).toBe("line")
			expect(mode.canvas.shapeRole, mode.id).toBe("glyph")
			expect(mode.canvas.areaRole, mode.id).toBe("mark")
			expect(mode.legend.hideLengthInThisMode, mode.id).toBe(true)
			expect(mode.canvas.supportsNegativeMeasure, mode.id).toBe(true)
		}
		expect(ComboXMode.canvas.measureAxis).toBe("y")
		expect(ComboYMode.canvas.measureAxis).toBe("x")
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

describe("axis + length traits", () => {
	it("every mode declares which cartesian axes it draws and what length means", () => {
		for (const mode of MODE_REGISTRY) {
			expect(typeof mode.canvas.cartesianAxes.x, mode.id).toBe("boolean")
			expect(typeof mode.canvas.cartesianAxes.y, mode.id).toBe("boolean")
			expect(["mark", "measure", "none"], mode.id).toContain(
				mode.canvas.lengthRole,
			)
		}
	})

	it("geo and polar panels draw no cartesian axes (except the pie bands' category axis)", () => {
		for (const mode of MODE_REGISTRY) {
			const { coordFamily, cartesianAxes } = mode.canvas
			if (coordFamily === "geo") {
				expect(cartesianAxes, mode.id).toEqual({ x: false, y: false })
			}
			if (coordFamily === "polar") {
				// At most one: the pies-x / pies-y band axis.
				expect(Number(cartesianAxes.x) + Number(cartesianAxes.y), mode.id)
					.toBeLessThanOrEqual(1)
			}
		}
		expect(PiesXMode.canvas.cartesianAxes).toEqual({ x: true, y: false })
		expect(PiesYMode.canvas.cartesianAxes).toEqual({ x: false, y: true })
	})

	it("a measure axis is always a drawn axis", () => {
		for (const mode of MODE_REGISTRY) {
			const { measureAxis, cartesianAxes } = mode.canvas
			if (measureAxis) expect(cartesianAxes[measureAxis], mode.id).toBe(true)
		}
	})

	it("lengthRole 'measure' exactly matches the measure-axis modes", () => {
		for (const mode of MODE_REGISTRY) {
			expect(mode.canvas.lengthRole === "measure", mode.id).toBe(
				mode.canvas.measureAxis !== null,
			)
		}
	})

	it("value-mode annotation channels exist only where a value axis is drawn", () => {
		// A declared value channel must be backed by something the renderer
		// scales against: a drawn cartesian axis, or radar's polar axes. The
		// axis-less structure layouts and the geo modes declare none, which
		// is what disables "data units" mode in the Annotations panel.
		for (const mode of MODE_REGISTRY) {
			const { xValueChannel, yValueChannel, polarValueCoords } = mode.annotations
			if (polarValueCoords) continue
			const { cartesianAxes } = mode.canvas
			expect(xValueChannel !== null, `${mode.id} x`).toBe(cartesianAxes.x)
			expect(yValueChannel !== null, `${mode.id} y`).toBe(cartesianAxes.y)
		}
	})
})

describe("mode families", () => {
	it("every family id is a registered mode", () => {
		const ids = new Set(MODE_REGISTRY.map((m) => m.id))
		for (const id of FAMILY_MODE_IDS) expect(ids.has(id), id).toBe(true)
	})
})

describe("sidebar traits (connection / shape / area / overlays / labels)", () => {
	// The sidebar panels never branch on mode ids either — they read these.
	// Every registered mode must declare a coherent set so a new mode can't
	// silently fall through a panel's gate. (families.test.ts proves each
	// trait gate matches the id list it replaced.)
	it("every mode declares the channel-role, overlay and label traits", () => {
		for (const mode of MODE_REGISTRY) {
			const { connectionRole, shapeRole, areaRole, statOverlays } = mode.canvas
			expect(["line", "layer", "polygon", "key", "none"], mode.id).toContain(
				connectionRole,
			)
			expect(["glyph", "cell", "outline", "none"], mode.id).toContain(shapeRole)
			expect(["mark", "layoutRadius", "proportional", "none"], mode.id).toContain(
				areaRole,
			)
			expect(typeof statOverlays, mode.id).toBe("boolean")
			expect(["mark", "ring", "layout"], mode.id).toContain(mode.labels.placement)
			expect(typeof mode.labels.positionLockedToAxes, mode.id).toBe("boolean")
			expect(typeof mode.labels.seriesEndpoints, mode.id).toBe("boolean")
			expect(typeof mode.labels.containerRimLabels, mode.id).toBe("boolean")
		}
	})

	it("polar modes declare polarAxes; non-polar modes don't", () => {
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.coordFamily === "polar") {
				expect(typeof mode.canvas.polarAxes?.r, mode.id).toBe("boolean")
				expect(typeof mode.canvas.polarAxes?.angle, mode.id).toBe("boolean")
			} else {
				expect(mode.canvas.polarAxes, mode.id).toBeUndefined()
			}
		}
		// Only radar draws polar axes; the pie bands draw neither.
		expect(RadarMode.canvas.polarAxes).toEqual({ r: true, angle: true })
		for (const pie of [PiesMode, PiesXMode, PiesYMode])
			expect(pie.canvas.polarAxes).toEqual({ r: false, angle: false })
	})

	it("geo modes declare the geo block; non-geo modes don't", () => {
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.coordFamily === "geo") {
				expect(["regions", "symbols"], mode.id).toContain(mode.canvas.geo?.marks)
				expect(["region", "lonLat"], mode.id).toContain(mode.canvas.geo?.position)
			} else {
				expect(mode.canvas.geo, mode.id).toBeUndefined()
			}
		}
		// Region-placed marks need the connection join; lon/lat marks don't.
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.geo?.position === "region")
				expect(mode.canvas.connectionRole, mode.id).toBe("key")
			if (mode.canvas.geo?.position === "lonLat")
				expect(mode.canvas.connectionRole, mode.id).toBe("none")
		}
	})

	it("flow modes declare flowGeometry; nothing else does", () => {
		for (const mode of MODE_REGISTRY) {
			if (isFlowModeId(mode.id)) {
				expect(["ring", "columns"], mode.id).toContain(mode.canvas.flowGeometry)
			} else {
				expect(mode.canvas.flowGeometry, mode.id).toBeUndefined()
			}
		}
	})

	it("connection is a structural KEY exactly in the structure layouts and the region-joined maps", () => {
		for (const mode of MODE_REGISTRY) {
			const expected =
				isStructureModeId(mode.id) || mode.canvas.geo?.position === "region"
			expect(mode.canvas.connectionRole === "key", mode.id).toBe(expected)
		}
	})

	it("cell-shaped marks only occur on panels that draw both cartesian axes", () => {
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.shapeRole === "cell")
				expect(mode.canvas.cartesianAxes, mode.id).toEqual({ x: true, y: true })
		}
	})

	it("statistical overlays only exist where both position scales are drawn", () => {
		for (const mode of MODE_REGISTRY) {
			if (mode.canvas.statOverlays)
				expect(mode.canvas.cartesianAxes, mode.id).toEqual({ x: true, y: true })
		}
	})

	it("layout-driven area sizing covers exactly the structure layouts", () => {
		for (const mode of MODE_REGISTRY) {
			const layoutSized =
				mode.canvas.areaRole === "layoutRadius" ||
				mode.canvas.areaRole === "proportional"
			expect(layoutSized, mode.id).toBe(isStructureModeId(mode.id))
		}
	})

	it("label traits are coherent: rim labels are layout-placed, locked positions have two axes to lock to", () => {
		for (const mode of MODE_REGISTRY) {
			// Rim labels are a tree-layout concept (containers to sit on).
			if (mode.labels.containerRimLabels)
				expect(isStructureModeId(mode.id), mode.id).toBe(true)
			// Locked positions need both chart axes to lock to.
			if (mode.labels.positionLockedToAxes)
				expect(mode.canvas.cartesianAxes, mode.id).toEqual({ x: true, y: true })
		}
	})
})
