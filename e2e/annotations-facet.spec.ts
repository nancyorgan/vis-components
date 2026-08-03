import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** Annotation rectangles in faceted charts.
 *
 *  A "values" (data-unit) annotation must land in the SAME place the chart
 *  itself would plot those data values — i.e. it must use each panel's
 *  real axis scale, including the share-axes resolution (all / perGroup /
 *  none). The reported bug: under shared axes the value-mode rectangle was
 *  built from each panel's OWN filtered rows instead of the shared row
 *  source, so the same data rectangle landed in a different (wrong) spot
 *  per panel — "all over the place" — while percent-mode stayed correct.
 *
 *  Test strategy: seed TWO rectangles into the same chart —
 *    - a percent rect covering the whole plot (xMin0..xMax1, yMin0..yMax1)
 *    - a values rect covering the whole DATA domain (the global nice
 *      extent, here [0,100]×[0,100])
 *  When the value-mode scale matches the chart, both rectangles cover the
 *  identical plot area in EVERY panel. We assert bbox(values) ≈ bbox(percent)
 *  per panel. That single invariant catches both the shared-domain bug and
 *  any value→pixel mapping drift, across wrap / col / row faceting.
 */

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

/** Two whole-coverage rectangles: one percent (always spans the plot), one
 *  values spanning the full [0,100]² data domain. Border thickness 0 so the
 *  client bbox is the geometric fill rect (no stroke inflation). */
const COVERAGE_ANNOTATIONS: SeedFixture["annotations"] = [
	{ id: "pct", coordSystem: "percent", xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
	{ id: "val", coordSystem: "values", xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
]

/** A percent circle centered mid-plot with radius 0.2·width, and a values
 *  circle centered at data (50,50) with a 20-unit x-radius. On a nice
 *  [0,100]² domain these coincide (50 is the domain midpoint; 20/100 of the
 *  range = 0.2·width), so the values circle must match the percent circle in
 *  every panel — proving circle value-mode uses the same per-panel scale. */
const COVERAGE_CIRCLES: SeedFixture["circleAnnotations"] = [
	{
		id: "cpct",
		coordSystem: "percent",
		centerX: 0.5,
		centerY: 0.5,
		radius: 0.2,
		radiusAxis: "x",
	},
	{
		id: "cval",
		coordSystem: "values",
		centerX: 50,
		centerY: 50,
		radius: 20,
		radiusAxis: "x",
	},
]

/** Per-panel: read the client bbox of the percent + values annotation
 *  rects, and assert they coincide within tolerance. Returns the count of
 *  panels actually checked so the test can assert it saw them all. */
const assertValuesMatchesPercentPerPanel = async (
	page: Page,
	expectedPanels: number,
	tolerancePx = 2,
) => {
	const report = await page.evaluate(() => {
		const svg = document.querySelector<SVGSVGElement>("svg#vc-scatter-svg")
		if (!svg) return { panels: [] as Array<Record<string, number>> }
		const panels = [...svg.querySelectorAll<SVGGElement>("[data-panel]")]
		const out: Array<{
			key: string
			hasPct: boolean
			hasVal: boolean
			dx: number
			dy: number
			dw: number
			dh: number
			pctW: number
			valW: number
		}> = []
		for (const p of panels) {
			const pct = p.querySelector<SVGRectElement>('[data-annotation="pct"]')
			const val = p.querySelector<SVGRectElement>('[data-annotation="val"]')
			const key = p.getAttribute("data-panel") ?? ""
			if (!pct || !val) {
				out.push({
					key,
					hasPct: !!pct,
					hasVal: !!val,
					dx: NaN,
					dy: NaN,
					dw: NaN,
					dh: NaN,
					pctW: NaN,
					valW: NaN,
				})
				continue
			}
			const a = pct.getBoundingClientRect()
			const b = val.getBoundingClientRect()
			out.push({
				key,
				hasPct: true,
				hasVal: true,
				dx: Math.abs(a.x - b.x),
				dy: Math.abs(a.y - b.y),
				dw: Math.abs(a.width - b.width),
				dh: Math.abs(a.height - b.height),
				pctW: a.width,
				valW: b.width,
			})
		}
		return { panels: out }
	})

	expect(report.panels.length).toBe(expectedPanels)
	for (const p of report.panels) {
		expect(p.hasPct, `panel ${p.key} missing percent rect`).toBe(true)
		expect(p.hasVal, `panel ${p.key} missing values rect`).toBe(true)
		// Diagnostic on failure: surface the actual widths.
		expect(
			Math.max(p.dx, p.dy, p.dw, p.dh),
			`panel ${p.key}: values rect diverges from percent rect ` +
				`(dx=${p.dx.toFixed(1)} dy=${p.dy.toFixed(1)} ` +
				`dw=${p.dw.toFixed(1)} dh=${p.dh.toFixed(1)}; ` +
				`pctW=${p.pctW.toFixed(1)} valW=${p.valW.toFixed(1)})`,
		).toBeLessThanOrEqual(tolerancePx)
	}
	return report.panels.length
}

/** Per-panel: assert the percent + values circle annotations coincide
 *  within tolerance (same invariant as the rectangle helper, applied to
 *  `<circle>` bounding boxes). */
const assertValuesCircleMatchesPercentPerPanel = async (
	page: Page,
	expectedPanels: number,
	tolerancePx = 2,
) => {
	const report = await page.evaluate(() => {
		const svg = document.querySelector<SVGSVGElement>("svg#vc-scatter-svg")
		if (!svg) return [] as Array<Record<string, number | boolean | string>>
		return [...svg.querySelectorAll<SVGGElement>("[data-panel]")].map((p) => {
			const pct = p.querySelector<SVGCircleElement>(
				'[data-annotation-circle="cpct"]',
			)
			const val = p.querySelector<SVGCircleElement>(
				'[data-annotation-circle="cval"]',
			)
			const key = p.getAttribute("data-panel") ?? ""
			if (!pct || !val)
				return { key, hasPct: !!pct, hasVal: !!val, d: NaN }
			const a = pct.getBoundingClientRect()
			const b = val.getBoundingClientRect()
			return {
				key,
				hasPct: true,
				hasVal: true,
				d: Math.max(
					Math.abs(a.x - b.x),
					Math.abs(a.y - b.y),
					Math.abs(a.width - b.width),
					Math.abs(a.height - b.height),
				),
			}
		})
	})
	expect(report.length).toBe(expectedPanels)
	for (const p of report) {
		expect(p.hasPct, `panel ${p.key} missing percent circle`).toBe(true)
		expect(p.hasVal, `panel ${p.key} missing values circle`).toBe(true)
		expect(
			p.d as number,
			`panel ${p.key}: values circle diverges from percent circle (d=${p.d})`,
		).toBeLessThanOrEqual(tolerancePx)
	}
}

/** Build a faceted fixture for one of the three facet flavours. `extents`
 *  controls whether every panel spans the same [0,100] domain ("same") or
 *  disjoint sub-bands that only UNION to [0,100] ("divergent" — exposes the
 *  shared-domain bug). */
const makeFixture = (opts: {
	flavour: "wrap" | "col" | "row"
	extents: "same" | "divergent"
	shareX: "none" | "perGroup" | "all"
	shareY: "none" | "perGroup" | "all"
}): SeedFixture => {
	const { flavour, extents, shareX, shareY } = opts
	const facetField =
		flavour === "wrap" ? "facet" : flavour === "col" ? "facetCol" : "facetRow"
	const groups = ["A", "B", "C"]
	// Points per panel. "same" → every panel covers 0..100 on both axes.
	// "divergent" → panel i covers a disjoint band; union = 0..100, each
	// band's own .nice() stays put (round numbers).
	const bands: Record<string, number[]> = {
		A: extents === "same" ? [0, 25, 50, 75, 100] : [0, 15, 30],
		B: extents === "same" ? [0, 25, 50, 75, 100] : [40, 50, 60],
		C: extents === "same" ? [0, 25, 50, 75, 100] : [70, 85, 100],
	}
	const rows: Array<Record<string, string>> = []
	for (const g of groups) {
		for (const v of bands[g]!) {
			rows.push({ g, x: String(v), y: String(v) })
		}
	}

	const encodings: SeedFixture["encodings"] = {
		x: { field: "x" },
		y: { field: "y" },
		[facetField]: { field: "g" },
	}

	// Wrap mode uses rows/cols on the facet config; col/row-only grids leave
	// them null (grid solver derives the strip).
	const facet: NonNullable<SeedFixture["facet"]> =
		flavour === "wrap"
			? { rows: 1, cols: 3, gapX: 30, gapY: 30, shareX, shareY }
			: { rows: null, cols: null, gapX: 30, gapY: 30, shareX, shareY }

	const id = `anno-${flavour}-${extents}-${shareX}-${shareY}`
	return {
		visualId: id,
		datasetId: `ds-${id}`,
		datasetName: id,
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
			{ name: "g", inferredType: "categorical" },
		],
		rows,
		encodings,
		facet,
		labels: { xAxisTitle: "x", yAxisTitle: "y" },
		annotations: COVERAGE_ANNOTATIONS,
	}
}

const FLAVOURS = ["wrap", "col", "row"] as const

for (const flavour of FLAVOURS) {
	test.describe(`Annotations — facet ${flavour}`, () => {
		test("values rect tracks the plot under SHARED axes (divergent panel extents)", async ({
			page,
		}) => {
			// The core regression: panels have disjoint data extents, axes are
			// shared, so the value-mode rect must use the unified [0,100]
			// domain — landing exactly where the percent rect does in EVERY
			// panel. Pre-fix this failed (per-panel domain → rect overshoots).
			const fixture = makeFixture({
				flavour,
				extents: "divergent",
				shareX: "all",
				shareY: "all",
			})
			await seedAndOpen(page, fixture)
			await assertValuesMatchesPercentPerPanel(page, 3)
		})

		test("values rect tracks each panel under UNSHARED axes (uniform extents)", async ({
			page,
		}) => {
			// Axes not shared, but every panel spans the same [0,100] domain,
			// so a value-mode rect over the full domain still covers the whole
			// plot in each panel — verifying the value→pixel mapping itself.
			const fixture = makeFixture({
				flavour,
				extents: "same",
				shareX: "none",
				shareY: "none",
			})
			await seedAndOpen(page, fixture)
			await assertValuesMatchesPercentPerPanel(page, 3)
		})

		test("values CIRCLE tracks the plot under SHARED axes (divergent panel extents)", async ({
			page,
		}) => {
			// Same machinery as rectangles: a data-unit circle must use the
			// shared per-panel scale, so it coincides with the equivalent
			// percent circle in every panel.
			const fixture = makeFixture({
				flavour,
				extents: "divergent",
				shareX: "all",
				shareY: "all",
			})
			fixture.circleAnnotations = COVERAGE_CIRCLES
			await seedAndOpen(page, fixture)
			await assertValuesCircleMatchesPercentPerPanel(page, 3)
		})

		test("percent rect is identical in every panel (sanity)", async ({
			page,
		}) => {
			const fixture = makeFixture({
				flavour,
				extents: "divergent",
				shareX: "all",
				shareY: "all",
			})
			await seedAndOpen(page, fixture)
			const widths = await page.evaluate(() => {
				const svg = document.querySelector("svg#vc-scatter-svg")!
				return [...svg.querySelectorAll("[data-panel]")].map((p) => {
					const r = p
						.querySelector('[data-annotation="pct"]')!
						.getBoundingClientRect()
					return { w: Math.round(r.width), h: Math.round(r.height) }
				})
			})
			expect(widths.length).toBe(3)
			const first = widths[0]!
			for (const w of widths) {
				expect(Math.abs(w.w - first.w)).toBeLessThanOrEqual(2)
				expect(Math.abs(w.h - first.h)).toBeLessThanOrEqual(2)
			}
		})
	})
}

/** Per-panel clipping: a value-mode rectangle is drawn in each panel's own
 *  data coordinates, and only the part that falls inside that panel's plot
 *  area paints. With UNSHARED axes and divergent extents, panel A spans
 *  data [0,30] while panel C spans [70,100]. A rect over the top band
 *  [70,100]² therefore covers panel C's whole plot but lies entirely
 *  outside panel A's — so it must clip to NOTHING in A and remain visible
 *  in C. We measure the intersection of each rect's geometry with its clip
 *  region (clip-aware; getBoundingClientRect ignores clip-path). */
test.describe("Annotations — per-panel clipping", () => {
	test("a value rect outside a panel's domain clips away; inside stays", async ({
		page,
	}) => {
		const fixture = makeFixture({
			flavour: "col",
			extents: "divergent",
			shareX: "none",
			shareY: "none",
		})
		fixture.annotations = [
			{ id: "val", coordSystem: "values", xMin: 70, xMax: 100, yMin: 70, yMax: 100 },
		]
		await seedAndOpen(page, fixture)
		const report = await page.evaluate(() => {
			const svg = document.querySelector("svg#vc-scatter-svg")
			if (!svg) return [] as Array<Record<string, number | string | boolean>>
			const num = (el: Element | null | undefined, a: string) =>
				Number(el?.getAttribute(a) ?? NaN)
			return [...svg.querySelectorAll("[data-panel]")].map((p) => {
				const rect = p.querySelector('[data-annotation="val"]')
				const key = p.getAttribute("data-panel") ?? ""
				if (!rect) return { key, hasRect: false, hasClip: false, visibleArea: NaN }
				// The clip region lives in the same annotation layer <g> as the rect.
				const layer = rect.closest('g[aria-hidden="true"]')
				const clip = layer?.querySelector("clipPath rect")
				const rx = num(rect, "x")
				const rw = num(rect, "width")
				const ry = num(rect, "y")
				const rh = num(rect, "height")
				const cx = num(clip, "x")
				const cw = num(clip, "width")
				const cy = num(clip, "y")
				const ch = num(clip, "height")
				const ix = Math.max(0, Math.min(rx + rw, cx + cw) - Math.max(rx, cx))
				const iy = Math.max(0, Math.min(ry + rh, cy + ch) - Math.max(ry, cy))
				return {
					key,
					hasRect: true,
					hasClip: Boolean(clip),
					visibleArea: Math.round(ix * iy),
				}
			})
		})
		expect(report.length).toBe(3)
		// Every painted annotation must be wrapped by a clip region.
		for (const p of report) {
			if (p.hasRect)
				expect(p.hasClip, `panel ${p.key} annotation is not clipped`).toBe(true)
		}
		const visibleAreas = report
			.filter((p) => p.hasRect)
			.map((p) => p.visibleArea as number)
		// At least one panel clips the rect to nothing (out-of-domain) and at
		// least one keeps it (in-domain). Pre-fix BOTH would paint full bleed.
		expect(
			visibleAreas.some((a) => a === 0),
			`expected a fully-clipped panel; areas=${visibleAreas.join(",")}`,
		).toBe(true)
		expect(
			visibleAreas.some((a) => a > 0),
			`expected a visible panel; areas=${visibleAreas.join(",")}`,
		).toBe(true)
	})
})
