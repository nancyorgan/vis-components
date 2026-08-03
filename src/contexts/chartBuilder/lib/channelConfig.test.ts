import { describe, expect, it } from "vitest"
import {
	colSizingMeaningful,
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
