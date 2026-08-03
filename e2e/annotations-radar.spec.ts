import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** Radar-chart circle annotations.
 *
 *  Percent-mode circles render in PlotCanvas's annotation layer against the
 *  panel's inner rect (so center (0.5,0.5) lands on the radar's center).
 *  VALUE-mode circles are polar: `centerX` is an ANGLE-axis value (a spoke),
 *  `centerY` an R-axis value, and the radius is in R-axis units. RadarPlot
 *  renders those using its own radial scales so they track the marks.
 *
 *  Strategy: seed both a percent circle at (0.5,0.5) — a stand-in for the
 *  radar center — and a value circle at the FIRST spoke ("A", which sits at
 *  12 o'clock / straight up) with a positive r. The value circle must sit
 *  directly above the center: same x, smaller y (higher on screen), nonzero
 *  radius. That proves the polar (angle,r)→pixel mapping fired. */

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

const radarFixture = (): SeedFixture => ({
	visualId: "vis-radar-anno",
	datasetId: "ds-radar-anno",
	datasetName: "radar-anno",
	fields: [
		{ name: "spoke", inferredType: "categorical" },
		{ name: "value", inferredType: "quantitative" },
	],
	rows: [
		{ spoke: "A", value: "30" },
		{ spoke: "B", value: "60" },
		{ spoke: "C", value: "90" },
	],
	encodings: {
		r: { field: "value" },
		angle: { field: "spoke" },
	},
	circleAnnotations: [
		// Reference: percent center == radar center.
		{
			id: "center",
			coordSystem: "percent",
			centerX: 0.5,
			centerY: 0.5,
			radius: 0.02,
			radiusAxis: "x",
			zOrder: "front",
			borderThickness: 1,
			backgroundOpacity: 0.3,
		},
		// Value circle on the 12 o'clock spoke, mid-domain r.
		{
			id: "val",
			coordSystem: "values",
			centerX: "A",
			centerY: 45,
			radius: 20,
			radiusAxis: "x",
			zOrder: "front",
			borderThickness: 1,
			backgroundOpacity: 0.3,
		},
	],
})

test.describe("Annotations — radar value-mode circles", () => {
	test("a value circle at the 12 o'clock spoke sits directly above the center", async ({
		page,
	}) => {
		await seedAndOpen(page, radarFixture())
		const geo = await page.evaluate(() => {
			const svg = document.querySelector("svg#vc-scatter-svg")
			if (!svg) return null
			const read = (id: string) => {
				const c = svg.querySelector<SVGCircleElement>(
					`[data-annotation-circle="${id}"]`,
				)
				if (!c) return null
				return {
					cx: c.cx.baseVal.value,
					cy: c.cy.baseVal.value,
					r: c.r.baseVal.value,
					coord: c.getAttribute("data-annotation-coord"),
				}
			}
			return { center: read("center"), val: read("val") }
		})
		expect(geo, "no SVG / circles found").not.toBeNull()
		expect(geo?.center, "percent reference circle missing").not.toBeNull()
		expect(geo?.val, "value circle missing").not.toBeNull()
		expect(geo?.val?.coord).toBe("values")
		// Same x as the radar center (spoke A points straight up).
		expect(Math.abs((geo!.val!.cx) - geo!.center!.cx)).toBeLessThanOrEqual(2)
		// Above the center: smaller y in SVG's top-down space.
		expect(geo!.val!.cy).toBeLessThan(geo!.center!.cy - 5)
		// A data-unit radius produced a real on-screen radius.
		expect(geo!.val!.r).toBeGreaterThan(0)
	})
})

/** "Size panels by unit" (proportionalPanelSizing) shrinks each radar disc by
 *  the panel's unit relative to the largest panel. Percent annotations must
 *  track that per-panel scale instead of staying full-panel-size. */
const sizedRadarFixture = (): SeedFixture => ({
	visualId: "vis-radar-anno-sized",
	datasetId: "ds-radar-anno-sized",
	datasetName: "radar-anno-sized",
	fields: [
		{ name: "region", inferredType: "categorical" },
		{ name: "spoke", inferredType: "categorical" },
		{ name: "value", inferredType: "quantitative" },
	],
	rows: (() => {
		const out: Array<Record<string, string>> = []
		// "High" panel max R = 100, "Low" panel max R = 50 → radiusScale 1.0
		// vs 0.5, so the discs (and percent annotations) differ 2×.
		const maxByRegion: Record<string, number> = { High: 100, Low: 50 }
		for (const region of ["High", "Low"]) {
			const max = maxByRegion[region]!
			for (const spoke of ["A", "B", "C"]) {
				const v = spoke === "A" ? max * 0.4 : spoke === "B" ? max * 0.7 : max
				out.push({ region, spoke, value: String(v) })
			}
		}
		return out
	})(),
	encodings: {
		r: { field: "value" },
		angle: { field: "spoke" },
		facetCol: { field: "region" },
	},
	facet: {
		rows: null,
		cols: null,
		gapX: 30,
		gapY: 30,
		shareX: "none",
		shareY: "none", // → shareR none, so each panel keeps its own unit
		proportionalPanelSizing: true,
	},
	circleAnnotations: [
		{
			id: "pct",
			coordSystem: "percent",
			centerX: 0.5,
			centerY: 0.5,
			radius: 0.3,
			radiusAxis: "x",
			zOrder: "front",
			borderThickness: 1,
			backgroundOpacity: 0.3,
		},
	],
})

test.describe("Annotations — radar percent circles track 'size by unit'", () => {
	test("a percent circle shrinks per panel with the disc (2× unit ⇒ 2× radius)", async ({
		page,
	}) => {
		await seedAndOpen(page, sizedRadarFixture())
		const widths = await page.evaluate(() => {
			const svg = document.querySelector("svg#vc-scatter-svg")
			if (!svg) return []
			return [...svg.querySelectorAll<SVGGElement>("[data-panel]")].map((p) => {
				const c = p.querySelector<SVGCircleElement>(
					'[data-annotation-circle="pct"]',
				)
				// Screen-space bbox reflects the per-panel scale transform
				// applied to the annotation group (the `r` attribute alone
				// does not — the transform lives on an ancestor <g>).
				return {
					key: p.getAttribute("data-panel") ?? "",
					w: c ? c.getBoundingClientRect().width : 0,
				}
			})
		})
		expect(widths.length).toBe(2)
		const big = Math.max(...widths.map((w) => w.w))
		const small = Math.min(...widths.map((w) => w.w))
		expect(small, "smaller panel circle should still render").toBeGreaterThan(0)
		// High panel (unit 100) disc is 2× the Low panel (unit 50), so its
		// percent circle should be ~2× as wide. Pre-fix the two were equal.
		expect(big / small).toBeGreaterThan(1.7)
		expect(big / small).toBeLessThan(2.3)
	})
})
