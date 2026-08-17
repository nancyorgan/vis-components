import { describe, expect, it } from "vitest"
import {
	colSizingMeaningful,
	migratePolarShareValue,
	migrateProportionalSizing,
	migrateShareValue,
	rowSizingMeaningful,
} from "./channelConfig"

describe("migrateShareValue", () => {
	it("returns 'all' for legacy boolean true", () => {
		expect(migrateShareValue(true, false)).toBe("all")
		expect(migrateShareValue(true, true)).toBe("all")
	})

	it("returns 'none' for legacy boolean false", () => {
		expect(migrateShareValue(false, true)).toBe("none")
		expect(migrateShareValue(false, false)).toBe("none")
	})

	it("falls back to shareAxes when value is undefined", () => {
		expect(migrateShareValue(undefined, true)).toBe("all")
		expect(migrateShareValue(undefined, false)).toBe("none")
	})

	it("passes through new tri-state values verbatim", () => {
		expect(migrateShareValue("none", true)).toBe("none")
		expect(migrateShareValue("perGroup", false)).toBe("perGroup")
		expect(migrateShareValue("all", false)).toBe("all")
	})
})

/** The polar sibling of migrateShareValue: R / angle store their own
 *  four-state share value, but visuals saved before those fields existed only
 *  carry the cartesian shareX / shareY (or the even older bundled shareAxes
 *  boolean). Read at 5 call sites — a regression here silently re-shares (or
 *  un-shares) a radar's rings on load. */
describe("migratePolarShareValue", () => {
	it("passes the polar value through verbatim when set (the no-op path)", () => {
		// Any polar value wins outright — the cartesian args are ignored, even
		// when they'd map to something else.
		expect(migratePolarShareValue("none", "all", true, "R")).toBe("none")
		expect(migratePolarShareValue("perRow", "none", false, "R")).toBe("perRow")
		expect(migratePolarShareValue("perCol", "all", true, "angle")).toBe("perCol")
		expect(migratePolarShareValue("all", false, false, "angle")).toBe("all")
	})

	it("falls back to the cartesian value when the polar field is unset", () => {
		expect(migratePolarShareValue(undefined, "none", true, "R")).toBe("none")
		expect(migratePolarShareValue(undefined, "all", false, "R")).toBe("all")
		expect(migratePolarShareValue(undefined, "none", true, "angle")).toBe("none")
		expect(migratePolarShareValue(undefined, "all", false, "angle")).toBe("all")
	})

	it("translates cartesian 'perGroup' per mapped axis (R → perRow, angle → perCol)", () => {
		expect(migratePolarShareValue(undefined, "perGroup", false, "R")).toBe(
			"perRow",
		)
		expect(migratePolarShareValue(undefined, "perGroup", false, "angle")).toBe(
			"perCol",
		)
	})

	it("maps the legacy cartesian booleans through migrateShareValue", () => {
		expect(migratePolarShareValue(undefined, true, false, "R")).toBe("all")
		expect(migratePolarShareValue(undefined, false, true, "R")).toBe("none")
		expect(migratePolarShareValue(undefined, true, false, "angle")).toBe("all")
		expect(migratePolarShareValue(undefined, false, true, "angle")).toBe("none")
	})

	it("falls back to the bundled shareAxes flag when the cartesian value is unset too", () => {
		expect(migratePolarShareValue(undefined, undefined, true, "R")).toBe("all")
		expect(migratePolarShareValue(undefined, undefined, false, "R")).toBe("none")
		expect(migratePolarShareValue(undefined, undefined, true, "angle")).toBe("all")
		expect(migratePolarShareValue(undefined, undefined, false, "angle")).toBe(
			"none",
		)
	})

	it("treats an undefined shareAxes as false (oldest configs → 'none')", () => {
		// Unlike migrateShareValue, the polar wrapper takes shareAxes as
		// optional and defaults it to false — the pre-shareAxes default.
		expect(migratePolarShareValue(undefined, undefined, undefined, "R")).toBe(
			"none",
		)
		expect(migratePolarShareValue(undefined, undefined, undefined, "angle")).toBe(
			"none",
		)
	})
})

describe("migrateProportionalSizing", () => {
	it("returns the per-axis value verbatim when set", () => {
		expect(migrateProportionalSizing("off", true, false)).toBe("off")
		expect(migrateProportionalSizing("categoryCount", false, true)).toBe(
			"categoryCount",
		)
		expect(migrateProportionalSizing("unit", undefined, undefined)).toBe("unit")
	})

	it("falls back to legacyByUnit=true → 'unit'", () => {
		expect(migrateProportionalSizing(undefined, true, true)).toBe("unit")
		expect(migrateProportionalSizing(undefined, undefined, true)).toBe("unit")
	})

	it("falls back to legacyOn=false → 'off'", () => {
		expect(migrateProportionalSizing(undefined, false, false)).toBe("off")
		expect(migrateProportionalSizing(undefined, false, undefined)).toBe("off")
	})

	it("defaults to 'categoryCount' when nothing is set or legacyOn=true with byUnit=false", () => {
		expect(migrateProportionalSizing(undefined, true, false)).toBe(
			"categoryCount",
		)
		expect(migrateProportionalSizing(undefined, undefined, false)).toBe(
			"categoryCount",
		)
		expect(migrateProportionalSizing(undefined, undefined, undefined)).toBe(
			"categoryCount",
		)
	})
})

/** UI (FacetOptionsPanel: show the sizing toggle / panel-dim inputs) and
 *  runtime (PlotCanvas: does sizing win over an explicit panelWidth/Height)
 *  share these predicates — the lockstep contract that keeps the sidebar
 *  from offering a pixel input the renderer would ignore. */
describe("rowSizingMeaningful / colSizingMeaningful", () => {
	it("rows: meaningful only for 1-col+shareY=none or 2+cols+shareY=perGroup", () => {
		expect(rowSizingMeaningful(4, 1, "none")).toBe(true)
		expect(rowSizingMeaningful(2, 3, "perGroup")).toBe(true)
	})

	it("rows: NOT meaningful under shareY='all' (uniform weights — explicit panelHeight must win)", () => {
		expect(rowSizingMeaningful(4, 1, "all")).toBe(false)
		expect(rowSizingMeaningful(2, 3, "all")).toBe(false)
	})

	it("rows: NOT meaningful for ambiguous / degenerate shapes", () => {
		expect(rowSizingMeaningful(1, 3, "none")).toBe(false) // single row
		expect(rowSizingMeaningful(2, 3, "none")).toBe(false) // 2D + none: per-row weight ambiguous
		expect(rowSizingMeaningful(4, 1, "perGroup")).toBe(false) // 1 col: perGroup needs 2+ cols
	})

	it("cols: mirrors the row predicate on the transposed shape", () => {
		expect(colSizingMeaningful(1, 4, "none")).toBe(true)
		expect(colSizingMeaningful(3, 2, "perGroup")).toBe(true)
		expect(colSizingMeaningful(1, 4, "all")).toBe(false)
		expect(colSizingMeaningful(3, 1, "none")).toBe(false) // single col
		expect(colSizingMeaningful(3, 2, "none")).toBe(false) // 2D + none: ambiguous
	})
})
