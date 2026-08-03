import { describe, expect, it } from "vitest"

import { sortByDrawOrder } from "./drawOrder"
import type { DatasetView } from "./types"

const makeDataset = (
	fields: DatasetView["fields"]
): DatasetView => ({
	id: "d1",
	name: "test",
	filename: "test.csv",
	fields,
	rows: [],
	createdAt: 0,
	versionId: "dv1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
	versionCreatedAt: 0,
})

const dataset = makeDataset([
	{ name: "size", inferredType: "quantitative" },
	{ name: "label", inferredType: "categorical" },
])

type Item = { id: string; row: Record<string, unknown> }
const item = (id: string, row: Record<string, unknown>): Item => ({ id, row })
const ids = (items: Item[]) => items.map((i) => i.id)

describe("sortByDrawOrder", () => {
	const items = [
		item("a", { size: "5", label: "mid" }),
		item("b", { size: "20", label: "big" }),
		item("c", { size: "1", label: "small" }),
	]

	it("returns the input untouched when no draw order is set", () => {
		expect(sortByDrawOrder(items, (i) => i.row, null, dataset)).toBe(items)
		expect(sortByDrawOrder(items, (i) => i.row, undefined, dataset)).toBe(
			items
		)
	})

	it("returns the input untouched when the field isn't in the dataset", () => {
		expect(
			sortByDrawOrder(items, (i) => i.row, { field: "gone", dir: "asc" }, dataset)
		).toBe(items)
	})

	it("returns the input untouched without a dataset", () => {
		expect(
			sortByDrawOrder(items, (i) => i.row, { field: "size", dir: "asc" }, undefined)
		).toBe(items)
	})

	it("sorts ascending by a quantitative field (highest drawn last / on top)", () => {
		const sorted = sortByDrawOrder(
			items,
			(i) => i.row,
			{ field: "size", dir: "asc" },
			dataset
		)
		expect(ids(sorted)).toEqual(["c", "a", "b"])
		expect(ids(items)).toEqual(["a", "b", "c"]) // input not mutated
	})

	it("sorts descending by a quantitative field (lowest drawn last / on top)", () => {
		const sorted = sortByDrawOrder(
			items,
			(i) => i.row,
			{ field: "size", dir: "desc" },
			dataset
		)
		expect(ids(sorted)).toEqual(["b", "a", "c"])
	})

	it("sorts categorical fields lexically", () => {
		const sorted = sortByDrawOrder(
			items,
			(i) => i.row,
			{ field: "label", dir: "asc" },
			dataset
		)
		expect(ids(sorted)).toEqual(["b", "a", "c"]) // big, mid, small
	})

	it("keeps ties in dataset order (stable)", () => {
		const tied = [
			item("a", { size: "5" }),
			item("b", { size: "5" }),
			item("c", { size: "5" }),
		]
		for (const dir of ["asc", "desc"] as const) {
			const sorted = sortByDrawOrder(
				tied,
				(i) => i.row,
				{ field: "size", dir },
				dataset
			)
			expect(ids(sorted)).toEqual(["a", "b", "c"])
		}
	})

	it("paints unparseable values first (bottom) in both directions", () => {
		// A missing cell coerces to "" → Number("") === 0, so it ranks as 0
		// (matching the data tray's sort); only truly unparseable text is
		// unrankable, and unrankable rows must never win an overlap.
		const mixed = [
			item("bad", { size: "n/a" }),
			item("hi", { size: "9" }),
			item("lo", { size: "2" }),
			item("missing", {}),
		]
		expect(
			ids(
				sortByDrawOrder(mixed, (i) => i.row, { field: "size", dir: "asc" }, dataset)
			)
		).toEqual(["bad", "missing", "lo", "hi"])
		expect(
			ids(
				sortByDrawOrder(mixed, (i) => i.row, { field: "size", dir: "desc" }, dataset)
			)
		).toEqual(["bad", "hi", "lo", "missing"])
	})

	describe("custom category order (levelOrders)", () => {
		// The user dragged "small" to the top of the legend, so the effective
		// order is small → mid → big, NOT alphabetical big → mid → small.
		const order = ["small", "mid", "big"]

		it("ascending ranks categories by their position in the custom order", () => {
			const sorted = sortByDrawOrder(
				items,
				(i) => i.row,
				{ field: "label", dir: "asc" },
				dataset,
				order
			)
			// asc = first-in-order drawn first (bottom): small, mid, big.
			expect(ids(sorted)).toEqual(["c", "a", "b"])
		})

		it("descending draws the top-of-order category last (on top)", () => {
			const sorted = sortByDrawOrder(
				items,
				(i) => i.row,
				{ field: "label", dir: "desc" },
				dataset,
				order
			)
			// desc reverses: big, mid, small — so "small" (top of the legend)
			// paints last and wins overlaps, which is the reported expectation.
			expect(ids(sorted)).toEqual(["b", "a", "c"])
		})

		it("differs from the alphabetical (no-order) result", () => {
			// Without a custom order the same desc sort is lexical big→mid→small
			// → [b, a, c] happens to match here, so use an order that diverges:
			// put "mid" on top.
			const midTop = ["mid", "big", "small"]
			const sorted = sortByDrawOrder(
				items,
				(i) => i.row,
				{ field: "label", dir: "desc" },
				dataset,
				midTop
			)
			// desc of [mid, big, small] = small, big, mid → "mid" last (on top).
			expect(ids(sorted)).toEqual(["c", "b", "a"])
		})

		it("categories missing from the order paint first (bottom), like unrankable", () => {
			const withExtra = [
				...items,
				item("d", { size: "3", label: "extra" }),
			]
			const sorted = sortByDrawOrder(
				withExtra,
				(i) => i.row,
				{ field: "label", dir: "asc" },
				dataset,
				order
			)
			// "extra" isn't in the order → bottom; the rest follow the order.
			expect(ids(sorted)).toEqual(["d", "c", "a", "b"])
		})

		it("an empty order falls back to the type comparator (lexical)", () => {
			const sorted = sortByDrawOrder(
				items,
				(i) => i.row,
				{ field: "label", dir: "asc" },
				dataset,
				[]
			)
			expect(ids(sorted)).toEqual(["b", "a", "c"]) // big, mid, small
		})
	})

	describe("size tie-break", () => {
		// Each item carries a resolved radius `r`; the scatter passes
		// `(a, b) => b.r - a.r` so a bigger mark paints first (behind) and the
		// smaller one stays visible on top.
		type Sized = { id: string; r: number; row: Record<string, unknown> }
		const sizedItem = (
			id: string,
			r: number,
			row: Record<string, unknown>
		): Sized => ({ id, r, row })
		const bigBehind = (a: Sized, b: Sized) => b.r - a.r

		it("breaks equal-value ties by radius (bigger first / behind)", () => {
			// All three share the same ordinal level, so the field can't order
			// them; the tie-break paints the largest first and the smallest last.
			const tied = [
				sizedItem("small", 2, { level: "hi" }),
				sizedItem("big", 9, { level: "hi" }),
				sizedItem("mid", 5, { level: "hi" }),
			]
			const sorted = sortByDrawOrder(
				tied,
				(i) => i.row,
				{ field: "level", dir: "asc" },
				makeDataset([{ name: "level", inferredType: "ordinal" }]),
				undefined,
				bigBehind
			)
			expect(sorted.map((i) => i.id)).toEqual(["big", "mid", "small"])
		})

		it("keeps the field ordering across levels, tie-breaking only within a level", () => {
			const rows = [
				sizedItem("lo-big", 9, { level: "1" }),
				sizedItem("lo-small", 1, { level: "1" }),
				sizedItem("hi-big", 8, { level: "2" }),
				sizedItem("hi-small", 2, { level: "2" }),
			]
			const sorted = sortByDrawOrder(
				rows,
				(i) => i.row,
				{ field: "level", dir: "asc" },
				makeDataset([{ name: "level", inferredType: "ordinal" }]),
				undefined,
				bigBehind
			)
			// Level asc first (1 before 2); within each level bigger paints first.
			expect(sorted.map((i) => i.id)).toEqual([
				"lo-big",
				"lo-small",
				"hi-big",
				"hi-small",
			])
		})

		it("tie-breaks when both values are unrankable", () => {
			const rows = [
				sizedItem("small", 2, { level: "n/a" }),
				sizedItem("big", 9, { level: "junk" }),
			]
			const sorted = sortByDrawOrder(
				rows,
				(i) => i.row,
				{ field: "level", dir: "asc" },
				makeDataset([{ name: "level", inferredType: "quantitative" }]),
				undefined,
				bigBehind
			)
			expect(sorted.map((i) => i.id)).toEqual(["big", "small"])
		})

		it("does not tie-break between a rankable and an unrankable row", () => {
			// The unrankable row sinks to the bottom regardless of its radius.
			const rows = [
				sizedItem("ranked-small", 1, { level: "5" }),
				sizedItem("bad-big", 9, { level: "n/a" }),
			]
			const sorted = sortByDrawOrder(
				rows,
				(i) => i.row,
				{ field: "level", dir: "asc" },
				makeDataset([{ name: "level", inferredType: "quantitative" }]),
				undefined,
				bigBehind
			)
			expect(sorted.map((i) => i.id)).toEqual(["bad-big", "ranked-small"])
		})
	})
})
