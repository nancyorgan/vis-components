import { expect, test, type Page } from "@playwright/test"
import { seedFixtureScript, type SeedFixture } from "./seed"

/** Tests that y-axis and x-axis tick labels render fully inside the
 *  chart SVG — no clipping at the canvas edges. Reproduces the user-
 *  reported "Cubed and Chopped" / "Upside Down Cake" / "Skewered and
 *  Grilled" truncation in a 2×2 wrap layout. */

const LONG_LABELS_DATASET: SeedFixture["fields"] = [
	{ name: "facet", inferredType: "categorical" },
	{ name: "group", inferredType: "categorical" },
	{ name: "year", inferredType: "quantitative" },
	{ name: "value", inferredType: "quantitative" },
]

// Each facet has different groups; some are long enough to test clipping.
const ROWS = [
	// Watermelon — short labels
	{ facet: "Watermelon", group: "Cubed", year: "2022", value: "0.05" },
	{ facet: "Watermelon", group: "Cubed", year: "2024", value: "0.10" },
	{ facet: "Watermelon", group: "Wedges", year: "2022", value: "0.07" },
	{ facet: "Watermelon", group: "Wedges", year: "2024", value: "0.14" },
	// Pineapple — long labels
	{ facet: "Pineapple", group: "Cubed and Chopped", year: "2022", value: "0.20" },
	{ facet: "Pineapple", group: "Cubed and Chopped", year: "2024", value: "0.25" },
	{ facet: "Pineapple", group: "Mashed", year: "2022", value: "0.10" },
	{ facet: "Pineapple", group: "Mashed", year: "2024", value: "0.15" },
	{ facet: "Pineapple", group: "Juiced", year: "2022", value: "0.02" },
	{ facet: "Pineapple", group: "Juiced", year: "2024", value: "0.05" },
	{ facet: "Pineapple", group: "Skewered and Grilled", year: "2022", value: "0.12" },
	{ facet: "Pineapple", group: "Skewered and Grilled", year: "2024", value: "0.14" },
	{ facet: "Pineapple", group: "Jam", year: "2022", value: "0.06" },
	{ facet: "Pineapple", group: "Jam", year: "2024", value: "0.13" },
	{ facet: "Pineapple", group: "Upside Down Cake", year: "2022", value: "0.04" },
	{ facet: "Pineapple", group: "Upside Down Cake", year: "2024", value: "0.06" },
	// Garbanzo Bean — medium labels
	{ facet: "Garbanzo Bean", group: "Boiled", year: "2022", value: "0.08" },
	{ facet: "Garbanzo Bean", group: "Boiled", year: "2024", value: "0.12" },
	{ facet: "Garbanzo Bean", group: "Sauteed", year: "2022", value: "0.10" },
	{ facet: "Garbanzo Bean", group: "Sauteed", year: "2024", value: "0.18" },
	{ facet: "Garbanzo Bean", group: "Dried", year: "2022", value: "0.06" },
	{ facet: "Garbanzo Bean", group: "Dried", year: "2024", value: "0.11" },
	// Hamburger — single label
	{ facet: "Hamburger", group: "Grilled", year: "2022", value: "0.13" },
	{ facet: "Hamburger", group: "Grilled", year: "2024", value: "0.15" },
]

const FIXTURE_WRAP_2X2: SeedFixture = {
	visualId: "vis-clip-wrap-2x2",
	datasetId: "ds-clip",
	datasetName: "clip-test",
	fields: LONG_LABELS_DATASET,
	rows: ROWS,
	encodings: {
		x: { field: "year" },
		y: { field: "group" },
		facet: { field: "facet" },
		// Match the user's setup where Hue is also mapped to facet, which
		// adds a legend on the right and compresses the chart panels.
		hue: { field: "facet" },
	},
	facet: {
		rows: 2,
		cols: 2,
		gapX: 30,
		gapY: 30,
		shareX: false,
		shareY: false,
	},
	labels: { xAxisTitle: "Year", yAxisTitle: "Group" },
}

const seedAndOpen = async (page: Page, fixture: SeedFixture) => {
	await page.addInitScript(seedFixtureScript(fixture))
	await page.goto(`/editor/${fixture.visualId}`, { waitUntil: "networkidle" })
	await page.waitForSelector("svg#vc-scatter-svg", { timeout: 8_000 })
	await page.waitForTimeout(500)
}

/** Collect every panel and the y-axis tick labels INSIDE each panel,
 *  with their bounding boxes. Used to detect labels that clip into a
 *  neighboring panel's plot area (label bleeds left of its cell's
 *  left edge or right of its cell's right edge). */
const collectPanelsAndLabels = async (page: Page) => {
	const data = await page.evaluate(() => {
		const svg = document.querySelector<SVGSVGElement>("svg#vc-scatter-svg")
		if (!svg) return null
		const svgBox = svg.getBoundingClientRect()
		const panels = [...svg.querySelectorAll<SVGGElement>("[data-panel]")]
		const panelData = panels.map((p) => {
			const key = p.getAttribute("data-panel") ?? ""
			const pBox = p.getBoundingClientRect()
			// Collect tick label <text> elements inside this panel. Renderer
			// emits axis ticks via <g class="vc-axis-tick"> or similar; we
			// take all <text> descendants and filter out the panel's facet
			// label (data-facet-label) and any svg-level titles.
			const texts = [...p.querySelectorAll<SVGTextElement>("text")]
				.filter((t) => {
					// Exclude facet-label texts (their parent <g> has data-facet-label)
					const inFacetLabel = t.closest("[data-facet-label]")
					if (inFacetLabel) return false
					if (!t.textContent || !t.textContent.trim()) return false
					return true
				})
				.map((t) => ({
					text: t.textContent ?? "",
					box: t.getBoundingClientRect(),
				}))
			return {
				key,
				panelLeft: pBox.left,
				panelRight: pBox.right,
				panelTop: pBox.top,
				panelBottom: pBox.bottom,
				texts,
			}
		})
		return {
			svgLeft: svgBox.left,
			svgRight: svgBox.right,
			panels: panelData,
		}
	})
	return data
}

test.describe("Label clipping — chart edges", () => {
	test("2×2 wrap, long y-categories, shareY=none: labels stay within their panel cell", async ({
		page,
	}) => {
		await seedAndOpen(page, FIXTURE_WRAP_2X2)
		const result = await collectPanelsAndLabels(page)
		expect(result).not.toBeNull()
		if (!result) return
		const { panels } = result
		const violations: Array<{
			panel: string
			text: string
			labelLeft: number
			panelLeft: number
			overhang: number
		}> = []
		for (const p of panels) {
			for (const t of p.texts) {
				if (t.box.left < p.panelLeft - 0.5) {
					violations.push({
						panel: p.key,
						text: t.text,
						labelLeft: t.box.left,
						panelLeft: p.panelLeft,
						overhang: p.panelLeft - t.box.left,
					})
				}
			}
		}
		if (violations.length > 0) {
			console.log("Labels bleeding left of their panel:", violations)
		}
		expect(
			violations,
			"y-axis labels clipping out of their panel cell",
		).toEqual([])
	})

	test("2×2 wrap, long y-categories, shareY='all': labels stay inside SVG", async ({
		page,
	}) => {
		// Under shareY="all", every panel renders the UNION of all groups
		// on its y-axis. The leftmost panel (Watermelon) used to size its
		// chrome from its OWN labels (short) — but the rendered axis shows
		// the wide union including "Upside Down Cake" / "Skewered and
		// Grilled". Regression for the chrome-uses-share-aware-labels fix.
		const fixture: SeedFixture = {
			...FIXTURE_WRAP_2X2,
			visualId: "vis-clip-wrap-2x2-shareY-all",
			facet: { ...FIXTURE_WRAP_2X2.facet!, shareY: "all", shareX: "all" },
		}
		await seedAndOpen(page, fixture)
		const data = await page.evaluate(() => {
			const svg = document.querySelector<SVGSVGElement>(
				"svg#vc-scatter-svg",
			)
			if (!svg) return null
			const svgBox = svg.getBoundingClientRect()
			const texts = [...svg.querySelectorAll<SVGTextElement>("text")]
				.filter((t) => {
					if (t.closest("[data-facet-label]")) return false
					if (!t.textContent || !t.textContent.trim()) return false
					return true
				})
				.map((t) => ({
					text: t.textContent ?? "",
					left: t.getBoundingClientRect().left,
				}))
			return { svgLeft: svgBox.left, texts }
		})
		expect(data).not.toBeNull()
		if (!data) return
		const clipping = data.texts.filter((t) => t.left < data.svgLeft - 0.5)
		if (clipping.length > 0) {
			console.log(
				`SVG left=${data.svgLeft}, clipped labels:`,
				clipping,
			)
		}
		expect(
			clipping,
			"labels clipping past SVG left edge under shareY=all",
		).toEqual([])
	})
})
