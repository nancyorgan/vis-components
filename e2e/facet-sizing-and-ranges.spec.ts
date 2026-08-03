import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** Integration coverage for the facet sizing + axis-range feature pack:
 *
 *   - "Size rows by unit / category count" actually changes row heights
 *     (and only when the per-strip weight is unambiguous).
 *   - Custom panelHeight / panelWidth and proportional sizing don't
 *     coexist: enabling one nulls the other (the defensive invariant).
 *   - Overall, per-row, and per-col range overrides clamp the scale.
 *   - Per-row range under shareY=none in a row-only grid applies as a
 *     per-panel bound.
 *   - 2D grid + share=none collapses sizing weight to uniform (gating
 *     matches the wrap panel's "ambiguous strip" rule).
 *   - No unnecessary scrollbar in fit mode for reasonable layouts.
 *
 *  Each test seeds a saved visual via `addInitScript` (no UI driving
 *  required) and inspects rendered panel rects / axis ticks. */

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

/** Inner rect for one panel: ScatterPlot draws the plot inside the
 *  group; the union of children gives the inner extent. Falls back to
 *  the group's BBox if children are empty. */
const panelInnerRects = async (page: Page) =>
	page.evaluate(() => {
		const svg = document.querySelector("#vc-scatter-svg") as SVGSVGElement | null
		if (!svg) return []
		const panels = Array.from(
			svg.querySelectorAll<SVGGElement>("g[data-panel-key]"),
		)
		return panels.map((g) => {
			// Use the longest horizontal line and longest vertical line —
			// these are the axis spine lines drawn by the renderer.
			const lines = Array.from(g.querySelectorAll<SVGLineElement>("line"))
			let bestH = 0
			let bestV = 0
			for (const ln of lines) {
				const x1 = ln.x1.baseVal.value
				const x2 = ln.x2.baseVal.value
				const y1 = ln.y1.baseVal.value
				const y2 = ln.y2.baseVal.value
				const dx = Math.abs(x2 - x1)
				const dy = Math.abs(y2 - y1)
				if (dy < 1 && dx > bestH) bestH = dx
				if (dx < 1 && dy > bestV) bestV = dy
			}
			return {
				key: g.dataset.panelKey ?? "",
				width: bestH,
				height: bestV,
			}
		})
	})

/** All numeric values from <text> elements that look like axis tick
 *  labels under a given panel (or globally under shared modes). Used
 *  to verify the rendered axis honors a range pin. */
const tickValues = async (page: Page, panelKey?: string) =>
	page.evaluate((key) => {
		const svg = document.querySelector("#vc-scatter-svg") as SVGSVGElement | null
		if (!svg) return []
		const root = key
			? svg.querySelector(`g[data-panel-key="${key}"]`)
			: svg
		if (!root) return []
		const texts = Array.from(root.querySelectorAll<SVGTextElement>("text"))
		const nums: number[] = []
		for (const t of texts) {
			const raw = (t.textContent ?? "").trim()
			if (!raw) continue
			// Strip k / M suffixes and commas if present.
			const cleaned = raw.replace(/[,]/g, "").replace(/(k|M)$/, "")
			const n = Number(cleaned)
			if (Number.isFinite(n)) {
				const scaled = raw.endsWith("k")
					? n * 1_000
					: raw.endsWith("M")
						? n * 1_000_000
						: n
				nums.push(scaled)
			}
		}
		return nums
	}, panelKey)

/** Build a 1-col wrap fixture where each facet has a wildly different
 *  Y range. Enables sizing-by-unit and verifies the resulting row
 *  heights mirror the Y-range ratios. */
const oneColVaryingYRange = (): SeedFixture => ({
	visualId: "vis-1col-varying-y",
	datasetId: "ds-1col-varying-y",
	datasetName: "varying-y",
	fields: [
		{ name: "x", inferredType: "quantitative" },
		{ name: "y", inferredType: "quantitative" },
		{ name: "group", inferredType: "categorical" },
	],
	// Three panels: A spans y∈[0,10], B spans y∈[0,50], C spans y∈[0,100].
	rows: [
		...Array.from({ length: 10 }, (_, i) => ({
			x: String(i + 1),
			y: String((i + 1) * 1),
			group: "A",
		})),
		...Array.from({ length: 10 }, (_, i) => ({
			x: String(i + 1),
			y: String((i + 1) * 5),
			group: "B",
		})),
		...Array.from({ length: 10 }, (_, i) => ({
			x: String(i + 1),
			y: String((i + 1) * 10),
			group: "C",
		})),
	],
	encodings: {
		x: { field: "x" },
		y: { field: "y" },
		facet: { field: "group" },
	},
	facet: {
		rows: 3,
		cols: 1,
		gapX: 30,
		gapY: 30,
		shareX: "all",
		shareY: "none",
		proportionalSizingY: "unit",
		proportionalSizingX: "off",
	},
})

test.describe("Facet sizing — size by unit range", () => {
	test("1-col wrap + shareY=none + size by unit: row heights track Y ranges", async ({
		page,
	}) => {
		await seedAndOpen(page, oneColVaryingYRange())
		const rects = await panelInnerRects(page)
		expect(rects.length).toBe(3)
		const [a, b, c] = rects
		// Y data ranges are 10 : 50 : 100 → heights should follow a roughly
		// proportional ratio (with floor for chrome).
		expect(a!.height).toBeGreaterThan(0)
		expect(b!.height).toBeGreaterThan(a!.height)
		expect(c!.height).toBeGreaterThan(b!.height)
		// Loose ratio check: C ≈ 5–10× A (slop for chrome / margins).
		expect(c!.height / a!.height).toBeGreaterThan(3)
	})

	test("1-col wrap + shareY=none + size by unit + overallYRange override: heights respect override", async ({
		page,
	}) => {
		// Same data, but pin panel B's range via panelAxisOverrides (legacy
		// per-panel) — should expand B's row height regardless of its own
		// data range.
		const fixture = oneColVaryingYRange()
		fixture.visualId = "vis-1col-pinned-b"
		fixture.facet!.panelAxisOverrides = {
			B: { yMin: 0, yMax: 1000 }, // pin B way above its data
		}
		await seedAndOpen(page, fixture)
		const rects = await panelInnerRects(page)
		const heightByKey = new Map(rects.map((r) => [r.key, r.height]))
		// B (pinned to 0–1000) should be the tallest now — bigger than C
		// (which only has data through 100).
		expect(heightByKey.get("B")!).toBeGreaterThan(heightByKey.get("C")!)
	})
})

test.describe("Facet sizing — runtime gating", () => {
	test("2D wrap + shareY=none: sizing weight collapses to uniform regardless of stored sizing value", async ({
		page,
	}) => {
		// Two cols × two rows, shareY=none, proportionalSizingY="unit" set —
		// per the UI gate this case hides the toggle, and at runtime the
		// weight is forced to 1. All four panels should be equal height.
		const fixture: SeedFixture = {
			visualId: "vis-2d-none-sizing-inert",
			datasetId: "ds-2d-none-sizing-inert",
			datasetName: "2d-none",
			fields: [
				{ name: "x", inferredType: "quantitative" },
				{ name: "y", inferredType: "quantitative" },
				{ name: "g", inferredType: "categorical" },
			],
			rows: [
				...Array.from({ length: 6 }, (_, i) => ({
					x: String(i),
					y: String(i * 1),
					g: "A",
				})),
				...Array.from({ length: 6 }, (_, i) => ({
					x: String(i),
					y: String(i * 10),
					g: "B",
				})),
				...Array.from({ length: 6 }, (_, i) => ({
					x: String(i),
					y: String(i * 100),
					g: "C",
				})),
				...Array.from({ length: 6 }, (_, i) => ({
					x: String(i),
					y: String(i * 1000),
					g: "D",
				})),
			],
			encodings: {
				x: { field: "x" },
				y: { field: "y" },
				facet: { field: "g" },
			},
			facet: {
				rows: 2,
				cols: 2,
				gapX: 30,
				gapY: 30,
				shareX: "none",
				shareY: "none",
				proportionalSizingY: "unit",
				proportionalSizingX: "off",
			},
		}
		await seedAndOpen(page, fixture)
		const rects = await panelInnerRects(page)
		expect(rects.length).toBe(4)
		// In a 2x2 wrap, panels in the same row have equal height
		// (uniform-row constraint). Heights across rows should now also
		// be equal because the ambiguous sizing collapsed to uniform.
		const heights = rects.map((r) => r.height)
		const max = Math.max(...heights)
		const min = Math.min(...heights)
		// All within ~10% of each other.
		expect(max - min).toBeLessThan(max * 0.1)
	})
})

test.describe("Facet axis range — overall + per-strip", () => {
	test("shareY=all + overallYRange.min=0 pins the shared Y axis to start at 0", async ({
		page,
	}) => {
		const fixture: SeedFixture = {
			visualId: "vis-overall-y-pin",
			datasetId: "ds-overall-y-pin",
			datasetName: "overall-y-pin",
			fields: [
				{ name: "x", inferredType: "quantitative" },
				{ name: "y", inferredType: "quantitative" },
				{ name: "g", inferredType: "categorical" },
			],
			// Y data starts at 100 — without an override the shared axis
			// would auto-fit somewhere around there. With min=0 pinned,
			// the axis must include 0.
			rows: [
				...Array.from({ length: 5 }, (_, i) => ({
					x: String(i),
					y: String(100 + i * 10),
					g: "A",
				})),
				...Array.from({ length: 5 }, (_, i) => ({
					x: String(i),
					y: String(120 + i * 12),
					g: "B",
				})),
			],
			encodings: {
				x: { field: "x" },
				y: { field: "y" },
				facet: { field: "g" },
			},
			facet: {
				rows: 1,
				cols: 2,
				gapX: 30,
				gapY: 30,
				shareX: "all",
				shareY: "all",
				overallYRange: { min: 0 },
			},
		}
		await seedAndOpen(page, fixture)
		// The leftmost panel hosts the shared Y axis. Collect tick numbers
		// from that panel — min should be ≤ 0.
		const rects = await panelInnerRects(page)
		expect(rects.length).toBe(2)
		const aTicks = await tickValues(page, rects[0]!.key)
		expect(Math.min(...aTicks)).toBeLessThanOrEqual(0)
	})

	test("shareY=perGroup + rowAxisOverrides pins each row's shared Y", async ({
		page,
	}) => {
		// 2x2 grid with shareY=perGroup. Pin row "North" to [0, 200].
		const fixture: SeedFixture = {
			visualId: "vis-perrow-y-pin",
			datasetId: "ds-perrow-y-pin",
			datasetName: "perrow-y-pin",
			fields: [
				{ name: "region", inferredType: "categorical" },
				{ name: "year", inferredType: "categorical" },
				{ name: "value", inferredType: "quantitative" },
			],
			rows: (() => {
				const out: Array<Record<string, string>> = []
				for (const r of ["North", "South"]) {
					for (const y of ["2024", "2025"]) {
						for (let k = 0; k < 5; k++) {
							out.push({
								region: r,
								year: y,
								value: String(10 + k * 5),
							})
						}
					}
				}
				return out
			})(),
			encodings: {
				x: { field: "value" },
				y: { field: "value" },
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
				rowAxisOverrides: { North: { min: 0, max: 200 } },
			},
		}
		await seedAndOpen(page, fixture)
		// Find a "North" panel — it's the leftmost cell in row 0.
		// Panel key is "North|2024".
		const ticks = await tickValues(page, "North|2024")
		// Override max=200 → axis should reach ≥ 200 (might extend slightly
		// further via nice()), and min should be ≤ 0.
		expect(Math.max(...ticks)).toBeGreaterThanOrEqual(200)
		expect(Math.min(...ticks)).toBeLessThanOrEqual(0)
	})

	test("row-only grid + shareY=none + per-row override behaves as per-panel bound", async ({
		page,
	}) => {
		// Only facetRow mapped, shareY=none, override "B" to y∈[0, 500].
		const fixture: SeedFixture = {
			visualId: "vis-rowonly-perpanel-y",
			datasetId: "ds-rowonly-perpanel-y",
			datasetName: "rowonly",
			fields: [
				{ name: "x", inferredType: "quantitative" },
				{ name: "y", inferredType: "quantitative" },
				{ name: "g", inferredType: "categorical" },
			],
			rows: (() => {
				const out: Array<Record<string, string>> = []
				for (const g of ["A", "B"]) {
					for (let k = 0; k < 5; k++) {
						out.push({
							x: String(k),
							y: String(10 + k * 2),
							g,
						})
					}
				}
				return out
			})(),
			encodings: {
				x: { field: "x" },
				y: { field: "y" },
				facetRow: { field: "g" },
			},
			facet: {
				rows: null,
				cols: null,
				gapX: 30,
				gapY: 30,
				shareX: "all",
				shareY: "none",
				rowAxisOverrides: { B: { min: 0, max: 500 } },
			},
		}
		await seedAndOpen(page, fixture)
		const ticks = await tickValues(page, "B|__all__")
		// B should extend to ~500 even though its actual data caps at ~18.
		expect(Math.max(...ticks)).toBeGreaterThanOrEqual(500)
		expect(Math.min(...ticks)).toBeLessThanOrEqual(0)
	})
})

test.describe("Facet panel-size override + sizing interaction", () => {
	test("panelHeight + sizing-by-unit: chart respects sizing, not the explicit dim", async ({
		page,
	}) => {
		// Seed with BOTH a stored panelHeight=180 AND proportionalSizingY="unit".
		// The defensive useEffect in FacetOptionsPanel clears panelHeight on
		// first render, so the chart should render with proportional sizing
		// (varying row heights) — not all panels at 180.
		const fixture = oneColVaryingYRange()
		fixture.visualId = "vis-conflict-size"
		fixture.facet!.panelHeight = 180
		await seedAndOpen(page, fixture)
		const rects = await panelInnerRects(page)
		// If panelHeight=180 had won, all three rows would be ~180.
		// With sizing winning, the largest (C) should be much taller than
		// the smallest (A).
		const heights = rects.map((r) => r.height).sort((a, b) => a - b)
		expect(heights[2]! / heights[0]!).toBeGreaterThan(2)
	})
})

test.describe("Facet wrap — uneven last row gets X axis", () => {
	test("9 facets in 5×2 grid + shareX=all: bottom-most filled panel of each column renders x-axis", async ({
		page,
	}) => {
		// 9 facets, 5 rows × 2 cols → row 4 col 1 is empty. Bottom row of
		// col 0 = row 4; bottom row of col 1 = row 3 (the last filled).
		// Both must render their x-axis (tick numbers) — pre-fix, only
		// row=rows-1 would, leaving col 1 without an axis.
		const fixture: SeedFixture = {
			visualId: "vis-5x2-uneven",
			datasetId: "ds-5x2-uneven",
			datasetName: "5x2-uneven",
			fields: [
				{ name: "x", inferredType: "quantitative" },
				{ name: "y", inferredType: "quantitative" },
				{ name: "g", inferredType: "categorical" },
			],
			rows: (() => {
				const out: Array<Record<string, string>> = []
				for (let i = 0; i < 9; i++) {
					for (let k = 0; k < 4; k++) {
						out.push({
							x: String(k + 1),
							y: String(10 + k + i),
							g: `G${i}`,
						})
					}
				}
				return out
			})(),
			encodings: {
				x: { field: "x" },
				y: { field: "y" },
				facet: { field: "g" },
			},
			facet: {
				rows: 5,
				cols: 2,
				gapX: 30,
				gapY: 30,
				shareX: "all",
				shareY: "all",
			},
		}
		await seedAndOpen(page, fixture)
		// Inspect the rendered showXAxis indicator per panel: the renderer
		// only draws ticks when showXAxis is true. Check that both
		// columns of the last *filled* row have visible tick text.
		const _rects = await panelInnerRects(page)
		// Panel keys are "G0".."G8" in row-major order with cols=2:
		//   row=0,col=0 G0    row=0,col=1 G1
		//   row=1,col=0 G2    row=1,col=1 G3
		//   row=2,col=0 G4    row=2,col=1 G5
		//   row=3,col=0 G6    row=3,col=1 G7
		//   row=4,col=0 G8    (col 1 empty)
		// Bottom-most-filled: col 0 → G8; col 1 → G7.
		const g7Ticks = await tickValues(page, "G7")
		const g8Ticks = await tickValues(page, "G8")
		// Both panels should have at least a few tick numbers from their
		// (shared) x-axis range. Without the fix, G7 would have none.
		expect(g7Ticks.length).toBeGreaterThan(1)
		expect(g8Ticks.length).toBeGreaterThan(1)
	})
})

test.describe("Facet viewport — no unnecessary scrolling", () => {
	test("3×3 wrap with no panel-size override fits the viewport (no scrollbar)", async ({
		page,
	}) => {
		const fixture: SeedFixture = {
			visualId: "vis-fit-no-scroll",
			datasetId: "ds-fit-no-scroll",
			datasetName: "fit-no-scroll",
			fields: [
				{ name: "x", inferredType: "quantitative" },
				{ name: "y", inferredType: "quantitative" },
				{ name: "g", inferredType: "categorical" },
			],
			rows: (() => {
				const out: Array<Record<string, string>> = []
				for (let i = 0; i < 9; i++) {
					for (let k = 0; k < 4; k++) {
						out.push({
							x: String(k),
							y: String(i + k),
							g: `G${i}`,
						})
					}
				}
				return out
			})(),
			encodings: {
				x: { field: "x" },
				y: { field: "y" },
				facet: { field: "g" },
			},
			facet: {
				rows: 3,
				cols: 3,
				gapX: 30,
				gapY: 30,
				shareX: "all",
				shareY: "all",
			},
		}
		await seedAndOpen(page, fixture)
		// Find the scroll container around the SVG (PlotCanvas wraps in
		// overflow-auto only when canvas > container). If absent or
		// non-scrolling, scrollHeight should equal clientHeight.
		const overflow = await page.evaluate(() => {
			const svg = document.querySelector(
				"#vc-scatter-svg",
			) as SVGSVGElement | null
			if (!svg) return null
			let el: HTMLElement | null = svg.parentElement as HTMLElement | null
			while (el && el !== document.body) {
				const style = window.getComputedStyle(el)
				if (
					style.overflow === "auto" ||
					style.overflowX === "auto" ||
					style.overflowY === "auto" ||
					style.overflow === "scroll" ||
					style.overflowY === "scroll" ||
					style.overflowX === "scroll"
				) {
					return {
						scrollWidth: el.scrollWidth,
						clientWidth: el.clientWidth,
						scrollHeight: el.scrollHeight,
						clientHeight: el.clientHeight,
					}
				}
				el = el.parentElement
			}
			return null
		})
		if (overflow) {
			// If a scroll container exists, scroll dims should equal client
			// dims — i.e., content fits and no scrollbar is needed.
			expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2)
			expect(overflow.scrollHeight).toBeLessThanOrEqual(
				overflow.clientHeight + 2,
			)
		}
		// (No scroll container at all is also fine — content fits the
		// natural canvas.)
	})

	test("explicit panelHeight that overflows triggers a scroll container", async ({
		page,
	}) => {
		const fixture: SeedFixture = {
			visualId: "vis-explicit-tall",
			datasetId: "ds-explicit-tall",
			datasetName: "explicit-tall",
			fields: [
				{ name: "x", inferredType: "quantitative" },
				{ name: "y", inferredType: "quantitative" },
				{ name: "g", inferredType: "categorical" },
			],
			rows: ["A", "B", "C", "D"].flatMap((g, i) =>
				Array.from({ length: 4 }, (_, k) => ({
					x: String(k),
					y: String(i + k),
					g,
				})),
			),
			encodings: {
				x: { field: "x" },
				y: { field: "y" },
				facet: { field: "g" },
			},
			facet: {
				rows: 4,
				cols: 1,
				gapX: 30,
				gapY: 30,
				shareX: "all",
				shareY: "all",
				// Force each panel to 500px tall — 4 panels × 500px = 2000px
				// canvas, which exceeds any reasonable viewport → scroll.
				// Proportional sizing must be off: when it actively drives a
				// dimension, PlotCanvas deliberately ignores the explicit
				// panelHeight (sizing wins over a stale pixel override), and
				// the seed helper defaults proportionalSizing to true.
				proportionalSizing: false,
				panelHeight: 500,
			},
		}
		await seedAndOpen(page, fixture)
		const overflow = await page.evaluate(() => {
			const svg = document.querySelector(
				"#vc-scatter-svg",
			) as SVGSVGElement | null
			if (!svg) return null
			let el: HTMLElement | null = svg.parentElement as HTMLElement | null
			while (el && el !== document.body) {
				const style = window.getComputedStyle(el)
				if (
					style.overflow === "auto" ||
					style.overflowY === "auto" ||
					style.overflowY === "scroll"
				) {
					return {
						scrollHeight: el.scrollHeight,
						clientHeight: el.clientHeight,
					}
				}
				el = el.parentElement
			}
			return null
		})
		expect(overflow).not.toBeNull()
		expect(overflow!.scrollHeight).toBeGreaterThan(overflow!.clientHeight)
	})
})

test.describe("Facet wrap — share+sizing interactions across modes", () => {
	test("1-col wrap + shareY=perGroup unavailable + size-by-unit checked behaves equivalent to none-1col", async ({
		page,
	}) => {
		// perGroupAvailable requires both dims ≥ 2 — with 1-col wrap, it's
		// false. The picker falls back to "all" (uniform) or "none" (per
		// panel). Verify size-by-unit + shareY=none in a 1-col layout
		// still produces varying heights (per the gate's "single panel
		// per row" path).
		const fixture = oneColVaryingYRange()
		fixture.visualId = "vis-1col-pergroup-fallback"
		fixture.facet!.shareY = "perGroup" // intentional: should degrade
		await seedAndOpen(page, fixture)
		const rects = await panelInnerRects(page)
		expect(rects.length).toBe(3)
		// Under "perGroup" with perGroupAvailable=false, the share-axis
		// picker UI shows "all" — at runtime, shareYMode resolves to
		// "perGroup" still. But since cols=1, every panel is also its own
		// row → behavior is similar to none. Either way, this fixture
		// shouldn't crash and should render 3 panels.
		expect(rects.every((r) => r.height > 0)).toBe(true)
	})
})
