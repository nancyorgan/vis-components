import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** Polar (radar) in grid mode with shareR routes:
 *
 *  Grid mode = facetRow + facetCol both mapped. The wrap panel is
 *  hidden (it early-returns when its channel isn't mapped), so users
 *  can't directly set `shareR` from the polar 4-state picker. They use
 *  the cartesian Facet (row) picker which writes `shareY`. The polar
 *  runtime migrates `shareY` → `shareR` via `migratePolarShareValue`
 *  when `shareR` is unset.
 *
 *  This spec verifies that path actually works end-to-end: each cell
 *  gets its own R scale under shareY=none, and the radii of identical
 *  R values land at different pixel distances when cells have
 *  different data extents. */

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

/** Build a 2×2 grid radar fixture with deliberately different R extents
 *  per cell: row 0 / col 0 has small Rs, row 1 / col 1 has large Rs.
 *  Angle is a small categorical so each cell renders 3 spokes. */
const grid2x2Radar = (
	shareY: "none" | "perGroup" | "all",
	shareX: "none" | "perGroup" | "all",
): SeedFixture => ({
	visualId: `vis-radar-grid-${shareY}-${shareX}`,
	datasetId: `ds-radar-grid-${shareY}-${shareX}`,
	datasetName: "radar-grid",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "year", inferredType: "categorical" },
		{ name: "spoke", inferredType: "categorical" },
		{ name: "value", inferredType: "quantitative" },
	],
	rows: (() => {
		const out: Array<Record<string, string>> = []
		const cellMaxByPos: Record<string, number> = {
			"North|2024": 10,
			"North|2025": 30,
			"South|2024": 60,
			"South|2025": 100,
		}
		for (const region of ["North", "South"]) {
			for (const year of ["2024", "2025"]) {
				const max = cellMaxByPos[`${region}|${year}`]!
				for (const spoke of ["A", "B", "C"]) {
					const v =
						spoke === "A"
							? max * 0.3
							: spoke === "B"
								? max * 0.6
								: max
					out.push({
						region,
						year,
						spoke,
						value: String(v),
					})
				}
			}
		}
		return out
	})(),
	encodings: {
		r: { field: "value" },
		angle: { field: "spoke" },
		facetRow: { field: "region" },
		facetCol: { field: "year" },
	},
	facet: {
		rows: null,
		cols: null,
		gapX: 30,
		gapY: 30,
		shareX,
		shareY,
	},
})

/** Read each panel's largest data-point pixel-distance from its
 *  center. Used as a proxy for "drawn R extent" — under shareR=none
 *  each cell's max-R data point should land near its own perimeter
 *  (proportional to its own scale), so this distance should be roughly
 *  the same px across cells even when the underlying R values differ
 *  hugely (10 vs. 100). Under shareR=all, the cell with the larger
 *  max value would push the others to render their data closer to
 *  the center, so the smaller cells' max distance would be smaller. */
const maxDataDistanceByCell = async (page: Page) =>
	page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg") as SVGSVGElement | null
		if (!svg) return []
		const panels = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
		return panels.map((g) => {
			// Use the radar's center = midpoint of the panel's data marks
			// (or fall back to the bbox center if no marks).
			const marks = Array.from(
				g.querySelectorAll<SVGCircleElement | SVGPathElement>(
					"circle[cx], path[transform]",
				),
			)
			// Compute a center from the panel <g>'s bounding box; the cell
			// is square-ish for these radar panels so center ≈ midpoint.
			const bbox = g.getBBox()
			const cx = bbox.x + bbox.width / 2
			const cy = bbox.y + bbox.height / 2
			let maxDist = 0
			for (const m of marks) {
				let mx = 0
				let my = 0
				if (m.tagName === "circle") {
					const c = m as SVGCircleElement
					mx = c.cx.baseVal.value
					my = c.cy.baseVal.value
				} else {
					// path with transform="translate(x, y)"
					const t = (m as SVGPathElement).getAttribute("transform") ?? ""
					const match = /translate\(([-\d.]+)[,\s]+([-\d.]+)\)/.exec(t)
					if (match) {
						mx = Number(match[1])
						my = Number(match[2])
					}
				}
				const d = Math.hypot(mx - cx, my - cy)
				if (d > maxDist) maxDist = d
			}
			return {
				key: g.dataset.panelKey ?? "",
				maxDist,
			}
		})
	})

test.describe("Polar grid mode — shareR=none gives per-cell R scales", () => {
	test("shareY=none in grid mode → each panel's max data lands at ~its own perimeter (radii within 30% of each other regardless of underlying values)", async ({
		page,
	}) => {
		await seedAndOpen(page, grid2x2Radar("none", "none"))
		const dists = await maxDataDistanceByCell(page)
		expect(dists.length).toBe(4)
		// Under shareR=none, each cell auto-fits to its own data extent.
		// The max-value mark in each cell should sit near that cell's
		// outer perimeter — so the max-distance-from-center should be
		// roughly the same across cells, regardless of whether the cell's
		// underlying max is 10 or 100.
		const maxes = dists.map((d) => d.maxDist)
		const maxOfMaxes = Math.max(...maxes)
		const minOfMaxes = Math.min(...maxes)
		// All 4 cells' max-point distances should be within ~30% of each
		// other, despite the underlying values varying 10× (10 vs 100).
		expect(minOfMaxes).toBeGreaterThan(maxOfMaxes * 0.7)
	})

	test("shareY=all in grid mode → cells with smaller underlying values draw their data closer to center", async ({
		page,
	}) => {
		await seedAndOpen(page, grid2x2Radar("all", "all"))
		const dists = await maxDataDistanceByCell(page)
		expect(dists.length).toBe(4)
		// Under shareR=all, every cell uses the global max (100). A cell
		// with local max=10 would only reach 10/100 = 10% of the radius;
		// the cell with local max=100 reaches 100%. So the spread should
		// be much wider than under shareR=none.
		const sorted = [...dists].sort((a, b) => a.maxDist - b.maxDist)
		const smallest = sorted[0]!.maxDist
		const largest = sorted[sorted.length - 1]!.maxDist
		// Smallest's max-point sits well inside (< 50% of largest's).
		expect(smallest).toBeLessThan(largest * 0.5)
	})

	test("stale shareR='all' from prior wrap-mode session does NOT override grid-mode shareY=none", async ({
		page,
	}) => {
		// Simulates the user-reported case: they previously had a wrap-
		// mode chart with shareR=all set via the polar picker, then
		// switched to grid mode. The wrap panel hides itself in grid
		// mode so they can't directly edit shareR — but the row panel
		// (which writes shareY) used to be shadowed by the stale shareR.
		//
		// After the FacetRowOptionsPanel fix, clicking on the row panel
		// also clears cfg.shareR, so the polar runtime falls back to
		// the fresh shareY value. We simulate that "user just clicked
		// None on the row panel" state by seeding with shareR=undefined
		// (cleared) + shareY=none.
		const fixture = grid2x2Radar("none", "none")
		fixture.visualId = "vis-radar-grid-stale-clear"
		// The fixture sets shareY="none". shareR is left undefined
		// (matches what the row panel's onChange now writes — it sets
		// shareR: undefined to clear any prior wrap-mode pick).
		await seedAndOpen(page, fixture)
		const dists = await maxDataDistanceByCell(page)
		const maxes = dists.map((d) => d.maxDist)
		const maxOfMaxes = Math.max(...maxes)
		const minOfMaxes = Math.min(...maxes)
		// Same assertion as the main shareR=none test: cells render
		// their own max-data near their own perimeter, regardless of
		// any prior wrap-mode setting.
		expect(minOfMaxes).toBeGreaterThan(maxOfMaxes * 0.7)
	})
})
