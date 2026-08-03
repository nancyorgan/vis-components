import { describe, expect, it } from "vitest"

import { DEFAULT_FACET_CONFIG } from "./channelConfig"
import type { FacetConfig } from "./channelConfig"
import {
	compactNonEmptyGrid,
	panelFacetValues,
	resolveFacetPanels,
} from "./resolveFacetPanels"
import type { FacetPanels } from "./resolveFacetPanels"
import type { DatasetView } from "./types"
import { emptyEncodings } from "./types"

const makeDataset = (rows: Array<Record<string, string>>): DatasetView => ({
	id: "d1",
	name: "test",
	filename: "test.csv",
	fields: [
		{ name: "r", inferredType: "categorical" },
		{ name: "c", inferredType: "categorical" },
		{ name: "v", inferredType: "quantitative" },
	],
	rows,
	createdAt: 0,
	versionId: "dv1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

/** One data row landing in facet cell (r, c). */
const rec = (r: string, c: string) => ({ r, c, v: "1" })

const gridEncodings = () => ({
	...emptyEncodings(),
	facetRow: { field: "r" },
	facetCol: { field: "c" },
})

const facetCfg = (overrides: Partial<FacetConfig> = {}): FacetConfig => ({
	...DEFAULT_FACET_CONFIG,
	...overrides,
})

/** Narrow to the grid arm so `compact` / rowValues / colValues are typed. */
const asGrid = (p: FacetPanels) => {
	if (p.mode !== "grid") throw new Error(`expected grid mode, got ${p.mode}`)
	return p
}

const resolve = (
	rows: Array<Record<string, string>>,
	cfg: FacetConfig,
	levelOrders: Record<string, readonly string[]> = {},
) => resolveFacetPanels(makeDataset(rows), gridEncodings(), levelOrders, {}, cfg)

describe("resolveFacetPanels hideEmptyPanels", () => {
	it("keeps the full cross-product when the toggle is off", () => {
		const result = asGrid(
			resolve(
				[rec("a", "x"), rec("c", "x"), rec("b", "y")],
				facetCfg({ hideEmptyPanels: false }),
			),
		)
		// 3 row values × 2 col values = 6 panels, empties included.
		expect(result.values.length).toBe(6)
		expect(result.compact).toBeUndefined()
	})

	it("is a no-op when no cell is empty", () => {
		const result = asGrid(
			resolve(
				[rec("a", "x"), rec("a", "y"), rec("b", "x"), rec("b", "y")],
				facetCfg({ hideEmptyPanels: true }),
			),
		)
		expect(result.values.length).toBe(4)
		expect(result.compact).toBeUndefined()
		expect(result.grid).toEqual({ rows: 2, cols: 2 })
	})

	it("compacts columns when every column has the same non-empty count", () => {
		// Columns x/y/z each have exactly 2 non-empty rows → dense 2×3 grid,
		// top strip survives, panels titled with their ROW value.
		const result = asGrid(
			resolve(
				[
					rec("a", "x"),
					rec("c", "x"),
					rec("b", "y"),
					rec("e", "y"),
					rec("a", "z"),
					rec("f", "z"),
				],
				facetCfg({ hideEmptyPanels: true }),
			),
		)
		expect(result.compact?.strip).toBe("cols")
		expect(result.grid).toEqual({ rows: 2, cols: 3 })
		expect(result.values).toEqual([
			"a|x",
			"b|y",
			"a|z",
			"c|x",
			"e|y",
			"f|z",
		])
		expect(result.compact?.panels["c|x"]).toEqual({
			rowValue: "c",
			colValue: "x",
			label: "c",
		})
		expect([...result.rowsByValue.keys()].sort()).toEqual(
			[...result.values].sort(),
		)
		// Surviving keys carry their actual data rows (one row for c·x above).
		expect(result.rowsByValue.get("c|x")).toHaveLength(1)
		// Full ordered domains survive for the header strips.
		expect(result.rowValues).toEqual(["a", "c", "b", "e", "f"])
		expect(result.colValues).toEqual(["x", "y", "z"])
	})

	it("compacts rows when rows are even but columns are not", () => {
		// Rows a/b each have 2 non-empty cols; columns are uneven
		// (x has 2, y and z have 1 each) → dense 2×2 grid, left strip
		// survives, panels titled with their COLUMN value.
		const result = asGrid(
			resolve(
				[rec("a", "x"), rec("a", "y"), rec("b", "x"), rec("b", "z")],
				facetCfg({ hideEmptyPanels: true }),
			),
		)
		expect(result.compact?.strip).toBe("rows")
		expect(result.grid).toEqual({ rows: 2, cols: 2 })
		expect(result.values).toEqual(["a|x", "a|y", "b|x", "b|z"])
		expect(result.compact?.panels["b|z"]?.label).toBe("z")
	})

	it("falls back to a wrap grid when neither direction is even", () => {
		// Row a has 3 panels, row b has 1; column x has 2, y and z have 1.
		const result = asGrid(
			resolve(
				[rec("a", "x"), rec("a", "y"), rec("a", "z"), rec("b", "x")],
				facetCfg({ hideEmptyPanels: true }),
			),
		)
		expect(result.compact?.strip).toBe("none")
		// resolveFacetGrid(4, null, null) → square-ish 2×2.
		expect(result.grid).toEqual({ rows: 2, cols: 2 })
		// Survivors keep the original row-major traversal order.
		expect(result.values).toEqual(["a|x", "a|y", "a|z", "b|x"])
		expect(result.compact?.panels["a|x"]?.label).toBe("a · x")
	})

	it("prefers column compaction when both directions are even", () => {
		// Diagonal: every row AND every column has exactly one panel.
		const result = asGrid(
			resolve(
				[rec("a", "x"), rec("b", "y")],
				facetCfg({ hideEmptyPanels: true }),
			),
		)
		expect(result.compact?.strip).toBe("cols")
		expect(result.grid).toEqual({ rows: 1, cols: 2 })
	})

	it("returns null when every cell is empty", () => {
		// Unreachable via resolveFacetPanels with data rows alone (every
		// data-derived value fills at least one cell), but reachable when a
		// row value's partner field is null everywhere — so exercise the
		// degenerate directly.
		expect(
			compactNonEmptyGrid(
				["a", "b"],
				["x"],
				new Map([
					["a|x", []],
					["b|x", []],
				]),
			),
		).toBeNull()
	})

	it("respects levelOrders when compacting", () => {
		const result = asGrid(
			resolve(
				[
					rec("a", "x"),
					rec("c", "x"),
					rec("b", "y"),
					rec("e", "y"),
					rec("a", "z"),
					rec("f", "z"),
				],
				facetCfg({ hideEmptyPanels: true }),
				{ r: ["f", "e", "c", "b", "a"], c: ["z", "y", "x"] },
			),
		)
		// Columns ordered z, y, x. Non-empty rows per column, in the
		// user's row order f,e,c,b,a:
		//   z → [f, a]   y → [e, b]   x → [c, a]
		// Row-major over the dense 2×3 grid:
		//   layout row 0 → z:f, y:e, x:c
		//   layout row 1 → z:a, y:b, x:a
		expect(result.compact?.strip).toBe("cols")
		expect(result.values).toEqual([
			"f|z",
			"e|y",
			"c|x",
			"a|z",
			"b|y",
			"a|x",
		])
	})
})

describe("panelFacetValues", () => {
	it("reads facet values from the compact descriptor when present", () => {
		const result = resolve(
			[
				rec("a", "x"),
				rec("c", "x"),
				rec("b", "y"),
				rec("e", "y"),
				rec("a", "z"),
				rec("f", "z"),
			],
			facetCfg({ hideEmptyPanels: true }),
		)
		expect(panelFacetValues(result, "c|x", 3)).toEqual({
			rowValue: "c",
			colValue: "x",
		})
	})

	it("reads facet values from the compact descriptor in the wrap fallback", () => {
		// Wrap fallback: strip "none", values ["a|x","a|y","a|z","b|x"] in a
		// 2×2 layout grid. Positional 2×2 arithmetic for idx 3 would say
		// layout row 1 / col 1 → "b"/"y", which is WRONG ("b|x" holds b·x).
		// This pins the compact-descriptor lookup path.
		const result = asGrid(
			resolve(
				[rec("a", "x"), rec("a", "y"), rec("a", "z"), rec("b", "x")],
				facetCfg({ hideEmptyPanels: true }),
			),
		)
		expect(result.compact?.strip).toBe("none")
		expect(result.values).toEqual(["a|x", "a|y", "a|z", "b|x"])
		expect(result.grid).toEqual({ rows: 2, cols: 2 })
		expect(panelFacetValues(result, "b|x", 3)).toEqual({
			rowValue: "b",
			colValue: "x",
		})
	})

	it("falls back to positional lookup on non-compact grids", () => {
		const result = resolve(
			[rec("a", "x"), rec("a", "y"), rec("b", "x"), rec("b", "y")],
			facetCfg({ hideEmptyPanels: true }),
		)
		// idx 3 in a 2×2 grid → row 1 ("b"), col 1 ("y").
		expect(panelFacetValues(result, asGrid(result).values[3], 3)).toEqual({
			rowValue: "b",
			colValue: "y",
		})
	})

	it("returns nulls outside grid mode", () => {
		const result = resolveFacetPanels(
			makeDataset([
				{ f: "a", v: "1" },
				{ f: "b", v: "2" },
			]),
			{ ...emptyEncodings(), facet: { field: "f" } },
			{},
			{},
			facetCfg(),
		)
		expect(result.mode).toBe("wrap")
		expect(panelFacetValues(result, result.values[0], 0)).toEqual({
			rowValue: null,
			colValue: null,
		})
	})
})
