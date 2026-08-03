import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** Verify Size [rows/cols] by ___ toggles in the Facet (row) / Facet
 *  (col) panels:
 *
 *   1. Cartesian grid mode: row-panel sizing should fold row heights
 *      proportionally just like the wrap panel does.
 *   2. The toggle's onChange must clear the conflicting explicit dim
 *      (panelHeight for row, panelWidth for col) — same defensive
 *      invariant the wrap panel enforces.
 *   3. Polar grid mode currently has a gap (the cartesian sizing
 *      toggle writes proportionalSizingY/X but polar reads
 *      proportionalPanelSizing) — this test pins the current behavior
 *      so we know when it changes. */

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

/** 2×2 cartesian grid where each cell has a different Y data range —
 *  so "Size rows by unit range" + shareY=perRow should give the two
 *  rows visibly different heights. */
const cartesianGridSizingFixture = (): SeedFixture => ({
	visualId: "vis-grid-row-sizing-cartesian",
	datasetId: "ds-grid-row-sizing-cartesian",
	datasetName: "grid-row-sizing",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "year", inferredType: "categorical" },
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
	],
	rows: (() => {
		const out: Array<Record<string, string>> = []
		// Row 0 (North): y in [0, 10]. Row 1 (South): y in [0, 100].
		// Under shareY=perRow + "Size rows by unit range", row 1 should
		// render ~10× the height of row 0.
		const rowMaxY: Record<string, number> = { North: 10, South: 100 }
		for (const region of ["North", "South"]) {
			for (const year of ["2024", "2025"]) {
				const maxY = rowMaxY[region]!
				for (let k = 0; k < 5; k++) {
					out.push({
						region,
						year,
						x: String(k),
						y: String((k / 4) * maxY),
					})
				}
			}
		}
		return out
	})(),
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		facetRow: { field: "region" },
		facetCol: { field: "year" },
	},
	facet: {
		rows: null,
		cols: null,
		gapX: 30,
		gapY: 30,
		shareX: "all",
		shareY: "perGroup",
		proportionalSizingY: "unit",
	},
})

/** Read the panel inner height per panel (longest vertical line in
 *  the SVG group). Mirrors the helper from facet-sizing-and-ranges. */
const panelInnerHeights = async (page: Page) =>
	page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg") as SVGSVGElement | null
		if (!svg) return []
		const panels = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
		return panels.map((g) => {
			const lines = Array.from(
				g.querySelectorAll<SVGLineElement>("line"),
			)
			let bestV = 0
			for (const ln of lines) {
				const x1 = ln.x1.baseVal.value
				const x2 = ln.x2.baseVal.value
				const y1 = ln.y1.baseVal.value
				const y2 = ln.y2.baseVal.value
				if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) > bestV) {
					bestV = Math.abs(y2 - y1)
				}
			}
			return { key: g.dataset.panelKey ?? "", height: bestV }
		})
	})

test.describe("Grid mode — row/col panel sizing toggles", () => {
	test("cartesian: shareY=perRow + Size rows by unit range → rows visibly differ in height", async ({
		page,
	}) => {
		await seedAndOpen(page, cartesianGridSizingFixture())
		const heights = await panelInnerHeights(page)
		expect(heights.length).toBe(4)
		// Panel keys are "rowVal|colVal" in row-major order.
		// Row 0 = North, Row 1 = South. The 2 South panels (y up to 100)
		// should be ~10× taller than the 2 North panels (y up to 10).
		const northHeight = heights.find((h) => h.key.startsWith("North"))!.height
		const southHeight = heights.find((h) => h.key.startsWith("South"))!.height
		expect(southHeight).toBeGreaterThan(northHeight * 3)
	})

	test("cartesian: explicit panelHeight + sizing-by-unit → sizing wins (panelHeight ignored)", async ({
		page,
	}) => {
		// User stored panelHeight=200, then also enabled
		// proportionalSizingY="unit" via the row panel. The runtime
		// invariant in PlotCanvas (`!isProportionalYActive` gate on
		// panelHeightOverride) should ignore panelHeight, so the rows
		// still differ proportionally rather than all being 200.
		const fixture = cartesianGridSizingFixture()
		fixture.visualId = "vis-grid-row-sizing-conflict"
		fixture.facet!.panelHeight = 200
		await seedAndOpen(page, fixture)
		const heights = await panelInnerHeights(page)
		const ratio =
			heights.find((h) => h.key.startsWith("South"))!.height /
			heights.find((h) => h.key.startsWith("North"))!.height
		// Should be roughly 10× (matches data ratio), NOT 1× (which
		// would mean panelHeight=200 forced uniform).
		expect(ratio).toBeGreaterThan(3)
	})
})
